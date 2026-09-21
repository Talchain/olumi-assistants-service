/**
 * The refusal predicate, and the twins it must NOT fire on.
 *
 * Every fixture below is a shape MEASURED on deployed staging on 2026-09-14,
 * not one imagined at the desk (CLAUDE.md trap 22: a corpus drawn from the
 * author's head cannot see the class the author did not imagine). Two live
 * scenarios supplied them:
 *   9677de7d-…  Paul's real session — the two refusals the ledger scored `answered`
 *   95c3dcdc-…  driven for this change — refusals AND their opposite-direction twins
 */
import { describe, it, expect } from 'vitest';

import { classifyUserVisibleRefusal } from '../user-visible-refusal.js';

function envelope(blocks: unknown[]): Record<string, unknown> {
  return {
    response_version: 2,
    assistant_text: 'text',
    blocks,
    suggested_actions: [],
    insights: [],
    stage_indicator: 'frame',
  };
}

/** The exact wire block `buildBoundaryBlocks` ships for a refused edit. */
function editRefusal(rejectionCode: string | null) {
  return {
    type: 'error',
    error_code: 'INTERNAL_ERROR',
    severity: 'warn',
    details: {
      source: 'edit_graph',
      ...(rejectionCode === null ? {} : { rejection_code: rejectionCode }),
    },
  };
}

describe('classifyUserVisibleRefusal — refusals', () => {
  // Measured live: each of these three codes was produced by a real staging
  // turn whose assistant_text was a refusal the user could read.
  it.each([
    ['OPERATION_DID_NOT_LAND', "I couldn't complete that change…"],
    ['ORPHAN_NODE', "I couldn't make that change in one edit…"],
    ['FEWER_THAN_TWO_OPTIONS', "I wasn't able to apply that change…"],
  ])('classifies %s as a refusal and reports the producer\'s own code', (code) => {
    const got = classifyUserVisibleRefusal(envelope([editRefusal(code)]));
    expect(got).not.toBeNull();
    expect(got?.refusal_code).toBe(code);
    expect(got?.source).toBe('edit_graph');
    expect(got?.error_code).toBe('INTERNAL_ERROR');
    expect(got?.severity).toBe('warn');
  });

  it('classifies a FATAL (severity error) failure block as a refusal too', () => {
    const got = classifyUserVisibleRefusal(
      envelope([
        {
          type: 'error',
          error_code: 'INTERNAL_ERROR',
          severity: 'error',
          details: { failure_origin: 'handler', error_code: 'plot_unavailable', retryable: true },
        },
      ]),
    );
    expect(got).not.toBeNull();
    expect(got?.severity).toBe('error');
  });

  it('reports a MISSING cause as null, never as a guess', () => {
    // "we do not know the cause" and "the cause was X" are different claims,
    // and a default would make the second out of the first.
    const got = classifyUserVisibleRefusal(envelope([editRefusal(null)]));
    expect(got).not.toBeNull();
    expect(got?.refusal_code).toBeNull();
    expect(got?.source).toBe('edit_graph');
  });

  it('finds the refusal block wherever it sits among content blocks', () => {
    const got = classifyUserVisibleRefusal(
      envelope([
        { type: 'coaching', coaching_kind: 'bias_signal' },
        { type: 'ui_directive', verb: 'focus' },
        editRefusal('ORPHAN_NODE'),
      ]),
    );
    expect(got?.refusal_code).toBe('ORPHAN_NODE');
  });
});

describe('classifyUserVisibleRefusal — the twins that must NOT be counted', () => {
  // ⭐ THIS BLOCK IS THE LOAD-BEARING HALF. A counter that fires on everything
  // is as useless as one that fires on nothing, and the obvious wrong
  // predicate is WITNESSED conflating these: `v5.edit_graph.turn` logged
  // `outcome="rejected" branch="clarify"` at 17:12:57Z on a turn whose
  // user-visible text was "Which option should I update: … or …?".
  it.each([
    ['a clarification (measured: blocks [])', []],
    ['an applied edit (measured: blocks [])', []],
    ['a no-op fallback (measured: blocks [])', []],
    [
      'a held proposal — carries a block, is not a refusal',
      [
        // THE REAL WIRE SHAPE. `edit-graph-dispatch.ts:3875-3885` ships the
        // redacted public reason as a LEADING error block and THEN appends the
        // held proposal, so an ordinary add-node/add-edge hold is
        // `[error, held_proposal]`. The previous fixture omitted the error
        // block and therefore proved nothing about this case.
        { type: 'error', error_code: 'INTERNAL_ERROR', severity: 'warn', details: { source: 'graph_management' } },
        { type: 'held_proposal', proposal_id: 'p1', operations: [] },
      ],
    ],
    [
      'a fresh draft (measured: three coaching blocks)',
      [
        { type: 'coaching', coaching_kind: 'bias_signal' },
        { type: 'coaching', coaching_kind: 'bias_signal' },
        { type: 'coaching', coaching_kind: 'bias_signal' },
      ],
    ],
    [
      'an analysis result with a ui_directive (measured on the real session)',
      [
        { type: 'analysis_result', summary: 'Ran analysis…', leading_option_id: null },
        { type: 'ui_directive', verb: 'focus', targets: [], source: 'ladder' },
      ],
    ],
  ])('does not count %s', (_label, blocks) => {
    expect(classifyUserVisibleRefusal(envelope(blocks as unknown[]))).toBeNull();
  });
});

describe('classifyUserVisibleRefusal — degrades to "not a refusal", never throws', () => {
  // This runs on the send path. A shape drift must not turn a delivered
  // response into a 500.
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'not an envelope'],
    ['an array', []],
    ['an envelope with no blocks key', { response_version: 2 }],
    ['an envelope whose blocks is not an array', { blocks: 'nope' }],
    ['blocks containing nulls', { blocks: [null, undefined, 7] }],
    ['an error block with no details', { blocks: [{ type: 'error', error_code: 'INTERNAL_ERROR' }] }],
  ])('%s', (_label, input) => {
    expect(() => classifyUserVisibleRefusal(input)).not.toThrow();
  });

  it('still classifies an error block that carries no details at all', () => {
    const got = classifyUserVisibleRefusal(
      envelope([{ type: 'error', error_code: 'UPSTREAM_TIMEOUT' }]),
    );
    expect(got).toEqual({
      error_code: 'UPSTREAM_TIMEOUT',
      severity: null,
      source: null,
      refusal_code: null,
    });
  });
});

describe('the KNOWN CLEAN-BODY composers — an honest gap, pinned', () => {
  /**
   * ⚠ These three composers ship `blocks: []` for a refusal BY DESIGN, so the
   * wire-shape predicate cannot see them. That is a real limitation, recorded
   * here rather than left for a later reader to discover as a silent
   * undercount (CLAUDE.md trap 22f: the honest way to ship a known gap is an
   * explicit set with a test asserting EXACTLY that set, so the suite REDs if
   * it grows OR shrinks).
   *
   * They remain countable via `turn_executor.failure_response`.
   *
   * If this assertion fails, a composer's body shape changed: either a fourth
   * composer started returning a clean body (extend the set AND check whether
   * its refusals are still counted somewhere), or one of these three started
   * marking the wire (remove it — this predicate now covers it).
   */
  const KNOWN_CLEAN_BODY_REFUSAL_COMPOSERS = [
    'composeRecoverableHandlerResponse',
    'composeRecoverableValidationResponse',
    'composeUnsupportedActionResponse',
  ] as const;

  it('is exactly these three, and each still ships blocks: [] in source', async () => {
    const { readFileSync } = await import('node:fs');
    const files = {
      composeRecoverableHandlerResponse: 'src/orchestrator-v5/compose/recoverable-handler-response.ts',
      composeRecoverableValidationResponse: 'src/orchestrator-v5/compose/recoverable-validation-response.ts',
      composeUnsupportedActionResponse: 'src/orchestrator-v5/compose/unsupported-action-response.ts',
    } as const;

    expect(Object.keys(files).sort()).toEqual([...KNOWN_CLEAN_BODY_REFUSAL_COMPOSERS].sort());

    for (const [fn, path] of Object.entries(files)) {
      const src = readFileSync(path, 'utf8');
      // Derived from the file, not mirrored: if the composer stops shipping a
      // clean body this REDs and the gap note above must be re-derived.
      expect(src, `${fn} (${path}) no longer declares an empty blocks array`).toContain('blocks: []');
      expect(src, `${fn} (${path}) must still export the named composer`).toContain(`export function ${fn}`);
    }
  });
});
