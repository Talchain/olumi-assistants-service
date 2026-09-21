/**
 * r1224-held-confirmation-bypass — the SECOND door onto the wrong-carrier write.
 *
 * #1224 (`e5af93dc`) wired `detectOptionOwnValueSubstitution` into
 * `effectiveAppliedMutation` in `edit-graph-dispatch.ts`, correctly described
 * there as "this dispatcher's single gate". That sentence is true only WITHIN
 * that dispatcher. `gm-held-execute.ts` is a SECOND, independent apply+commit
 * path (propose → hold → confirm → apply) that never enters it, so a user who
 * confirms a held proposal reaches the same substitution with no guard at all
 * and is told *"Confirmed: change 'Coverage Pilot' to 30% ..."* — byte-for-byte
 * the sentence the external auditor caught.
 *
 * The graphs here are the auditor's OWN wire-captured readbacks
 * (`../../routing/__tests__/fixtures/option-observed-state-substitution-capture.json`),
 * not a fixture written from this lane's head (trap 16: a fixture you wrote
 * yourself is not evidence about the wire).
 *
 * The three arms are a DISCRIMINATING SET, not one assertion repeated: the
 * withhold arm and the S3 twin differ by exactly one operation (the effect
 * write), so a guard that simply refused every option edit would turn the twin
 * RED. Every assertion binds to the option BY ID (`70180763`), never by a value
 * predicate its sibling option `4bba0554` could also satisfy (trap 19).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { executeGmHeldResume } from '../gm-held-execute.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import * as telemetry from '../../../utils/telemetry.js';
import { log } from '../../../utils/telemetry.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CAPTURE = JSON.parse(
  readFileSync(
    join(HERE, '../../routing/__tests__/fixtures/option-observed-state-substitution-capture.json'),
    'utf8',
  ),
) as Record<string, { nodes: unknown[]; edges: unknown[] }>;

/** The auditor's pre-edit graph, exactly as read back from the durable store. */
const BEFORE = CAPTURE.before as unknown as Record<string, unknown>;

/** "Coverage Pilot" — the option whose OWN value the witnessed turn wrote. */
const PILOT_ID = '70180763';
/** "Staffed Coverage" — the factor Coverage Pilot's real effect value sits on. */
const STAFFED_COVERAGE_ID = '0d2a1d17';

function hashOf(graph: unknown): string {
  const h = computeAnalysisAffectingGraphHash(graph as never);
  if (h === null) throw new Error('fixture must hash');
  return h;
}

/**
 * The wrong-carrier write, in the UNSTAMPED spelling the edit LLM emits.
 * `source` / `raw_value` are PIPELINE_OWNED_ROOTS and are stamped by
 * gm-held-execute itself AFTER the referee, so a hand-stamped payload is one
 * the pipeline never referees and is rejected for a reason incidental to this
 * defect.
 */
const OPTION_OWN_VALUE_OP = {
  op: 'update_node',
  path: PILOT_ID,
  value: { observed_state: { value: 30, unit: '%', baseline: 70 } },
};

/** The write the user actually meant: the option's effect on the factor. */
const OPTION_EFFECT_OP = {
  op: 'update_node',
  path: PILOT_ID,
  value: { interventions: { [STAFFED_COVERAGE_ID]: { value: 0.3 } } },
};

/** A control that touches the same option and no quantity at all. */
const RENAME_OP = {
  op: 'update_node',
  path: PILOT_ID,
  value: { label: 'Coverage Pilot (revised)' },
};

function executeInput(
  operations: readonly unknown[],
): Parameters<typeof executeGmHeldResume>[0] {
  return {
    operations: operations as never,
    currentGraph: BEFORE,
    currentGraphHash: hashOf(BEFORE),
    freshness: 'none',
    hasExistingAnalysis: false,
    scenarioId: 'scn-r1224-held',
    turnId: 'turn-r1224-held',
    requestId: 'req-r1224-held',
  };
}

/** Read ONE option's effect value on ONE factor, by both ids. */
function effectValue(graph: { nodes: ReadonlyArray<Record<string, unknown>> }): unknown {
  const node = graph.nodes.find((n) => n.id === PILOT_ID);
  const interventions = node?.interventions as Record<string, unknown> | undefined;
  const entry = interventions?.[STAFFED_COVERAGE_ID];
  if (entry !== null && typeof entry === 'object') {
    return (entry as Record<string, unknown>).value;
  }
  return entry;
}

/** Read ONE option's own observed value, by id. */
function ownValue(graph: { nodes: ReadonlyArray<Record<string, unknown>> }): unknown {
  const node = graph.nodes.find((n) => n.id === PILOT_ID);
  const observed = node?.observed_state as Record<string, unknown> | undefined;
  return observed?.value;
}

let emitSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  emitSpy = vi.spyOn(telemetry, 'emit').mockImplementation(() => {});
  warnSpy = vi.spyOn(log, 'warn').mockImplementation((() => {}) as never);
});
afterEach(() => {
  emitSpy.mockRestore();
  warnSpy.mockRestore();
});

describe('gm-held confirm — an option\'s own observed_state is not a carrier for its effect value', () => {
  // ⭐ THE DISCRIMINATOR PINS ITS OWN PRECONDITION (trap 13b). If the captured
  // graph ever stopped carrying this exact starting state, the arms below would
  // still be GREEN while discriminating nothing.
  it('PRECONDITION — captured option 70180763 starts with NO own value and an effect of 0.7 on 0d2a1d17', () => {
    const before = BEFORE as unknown as { nodes: ReadonlyArray<Record<string, unknown>> };
    const pilot = before.nodes.find((n) => n.id === PILOT_ID);
    expect(pilot?.kind).toBe('option');
    expect(pilot?.observed_state).toBeUndefined();
    expect(effectValue(before)).toBe(0.7);
  });

  it('withholds the WHOLE confirmed batch when option 70180763\'s own value moved and its effect on 0d2a1d17 did not', () => {
    const outcome = executeGmHeldResume(executeInput([OPTION_OWN_VALUE_OP]));

    // Nothing to persist, and nothing to narrate as "Confirmed:".
    expect(outcome.status).toBe('apply_failed');
    expect(outcome.status === 'apply_failed' ? outcome.reason : null).toBe(
      'option_own_value_withheld',
    );
    expect(outcome).not.toHaveProperty('appliedGraph');

    // IDENTITY BINDING: the refusal names THIS option, not "an option".
    const calls = warnSpy.mock.calls as ReadonlyArray<readonly unknown[]>;
    const withheldWarn = calls.find(
      (c) => typeof c[1] === 'string' && c[1].includes('own observed_state'),
    );
    expect(withheldWarn).toBeDefined();
    expect((withheldWarn?.[0] as { option_ids?: string[] })?.option_ids).toEqual([PILOT_ID]);
  });

  it('S3 TWIN — the SAME wrong-carrier write EXECUTES when option 70180763\'s effect on 0d2a1d17 moved too', () => {
    const outcome = executeGmHeldResume(
      executeInput([OPTION_OWN_VALUE_OP, OPTION_EFFECT_OP]),
    );

    expect(outcome.status).toBe('executed');
    if (outcome.status !== 'executed') throw new Error('unreachable');
    // The user's real work landed, on the named option and the named factor.
    expect(effectValue(outcome.appliedGraph as never)).toBe(0.3);
    expect(ownValue(outcome.appliedGraph as never)).toBe(30);
  });

  it('CONTROL — a confirmed rename of option 70180763 still executes', () => {
    const outcome = executeGmHeldResume(executeInput([RENAME_OP]));

    expect(outcome.status).toBe('executed');
    if (outcome.status !== 'executed') throw new Error('unreachable');
    const renamed = (outcome.appliedGraph.nodes as ReadonlyArray<Record<string, unknown>>).find(
      (n) => n.id === PILOT_ID,
    );
    expect(renamed?.label).toBe('Coverage Pilot (revised)');
  });
});
