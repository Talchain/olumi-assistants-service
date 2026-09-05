/**
 * The brief hash assertion, the payload readers, and the identity binding.
 *
 * Three separate things live here because each is a place a harness quietly
 * measures the wrong thing:
 *
 *   BRIEF     — "A harness that reports which fixture it *thinks* it sent is
 *               not evidence" (PROTOCOL.md rule 3).
 *   READERS   — the wire block discriminant is `type`, not `block_type`. A
 *               harness reading the wrong one returns a perfect clean zero.
 *   BINDING   — C5's target is bound by NODE ID. A value predicate ("the
 *               factor whose value is 80") would pass on a different object.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  BriefHashMismatchError,
  assertSentBrief,
  loadBrief,
  parseSha256Sidecar,
  sha256Of,
} from '../../../tools/founder-fixture-harness/brief.js';
import {
  blockType,
  blocksOfType,
  collectAllKeys,
  collectUserVisibleStrings,
} from '../../../tools/founder-fixture-harness/payload-scan.js';
import {
  findNoChangeDenial,
  findStabilityVerdict,
  resolveTargetNode,
  valueDesignates,
} from '../../../tools/founder-fixture-harness/criteria.js';
import { readGraphPatches } from '../../../tools/founder-fixture-harness/admission.js';
import type { TurnCapture } from '../../../tools/founder-fixture-harness/types.js';

// ---------------------------------------------------------------------------

describe('brief hash assertion', () => {
  function tempBrief(text: string, sidecar: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'founder-brief-'));
    const path = join(dir, 'BRIEF-FOUNDER-VERBATIM.txt');
    writeFileSync(path, text, 'utf8');
    writeFileSync(`${path}.sha256`, sidecar, 'utf8');
    return path;
  }

  it('loads a brief whose sidecar agrees', () => {
    const text = 'We are deciding whether to hire.\n';
    const path = tempBrief(text, `${sha256Of(text)}  BRIEF-FOUNDER-VERBATIM.txt\n`);
    const brief = loadBrief(path);
    expect(brief.sha256).toBe(sha256Of(text));
    expect(brief.bytes).toBe(Buffer.byteLength(text, 'utf8'));
  });

  it('REFUSES a brief whose sidecar disagrees — a truncated brief must never pass unnoticed', () => {
    const text = 'We are deciding whether to hire.\n';
    const path = tempBrief(`${text}TRUNCATED`, `${sha256Of(text)}  BRIEF-FOUNDER-VERBATIM.txt\n`);
    expect(() => loadBrief(path)).toThrow(BriefHashMismatchError);
  });

  it('REFUSES a sidecar that names a different file rather than assuming they match', () => {
    expect(() => parseSha256Sidecar(`${'a'.repeat(64)}  SOME-OTHER-FILE.txt\n`, 'BRIEF-FOUNDER-VERBATIM.txt')).toThrow(
      BriefHashMismatchError,
    );
  });

  it('REFUSES when there is no sidecar at all — nothing to assert against is not a pass', () => {
    const dir = mkdtempSync(join(tmpdir(), 'founder-brief-'));
    const path = join(dir, 'BRIEF-FOUNDER-VERBATIM.txt');
    writeFileSync(path, 'text', 'utf8');
    expect(() => loadBrief(path)).toThrow(/No sha256 sidecar/);
  });

  it('re-hashes the brief OFF THE SERIALISED REQUEST BODY, not off the variable it was read into', () => {
    const text = 'the brief';
    const good = JSON.stringify({ kind: 'message', message: text });
    expect(() => assertSentBrief(good, sha256Of(text))).not.toThrow();

    // The failure this catches: the builder truncated, trimmed, or re-encoded.
    const truncated = JSON.stringify({ kind: 'message', message: text.slice(0, 3) });
    expect(() => assertSentBrief(truncated, sha256Of(text))).toThrow(BriefHashMismatchError);

    // And a body carrying no message at all is a mismatch, not an absence.
    expect(() => assertSentBrief(JSON.stringify({ kind: 'message' }), sha256Of(text))).toThrow(
      /no string `message` field/,
    );
  });
});

// ---------------------------------------------------------------------------

describe('payload readers — the wire discriminant is `type`', () => {
  const wireBody = {
    assistant_text: 'top level prose',
    blocks: [
      { type: 'analysis_result', summary: 'result prose', leading_option_id: null },
      { type: 'graph_patch', status: 'applied', operation: 'set_factor_value', target_id: 'fac_x', before: { value: 80 }, after: { value: 100000 } },
      { type: 'text', content: 'block prose' },
    ],
    suggested_actions: [{ id: 'c', label: 'Run analysis', message: 'Run analysis.' }],
  } as never;

  it('reads a wire block by `type`', () => {
    expect(blockType({ type: 'graph_patch' })).toBe('graph_patch');
    expect(blocksOfType(wireBody, 'analysis_result')).toHaveLength(1);
    expect(blocksOfType(wireBody, 'graph_patch')).toHaveLength(1);
  });

  it('also reads the orchestrator-internal `block_type`, so either fixture shape scans', () => {
    // The two shapes exist and are differently named; a reader that knew only
    // one of them would return a confident zero on the other.
    expect(blockType({ block_type: 'graph_patch' })).toBe('graph_patch');
    const internal = { blocks: [{ block_type: 'graph_patch', data: { status: 'noop', target_id: 'fac_y' } }] } as never;
    expect(readGraphPatches(internal)[0]?.status).toBe('noop');
    expect(readGraphPatches(internal)[0]?.target_id).toBe('fac_y');
  });

  it('collects the prose members of the boundary block schemas', () => {
    const paths = collectUserVisibleStrings(wireBody).map((s) => s.path);
    expect(paths).toContain('assistant_text');
    expect(paths).toContain('blocks[0].summary');
    expect(paths).toContain('blocks[2].content');
    expect(paths).toContain('suggested_actions[0].label');
  });

  it('reads the boundary graph_patch: status applied|noop, with the target id', () => {
    const patches = readGraphPatches(wireBody);
    expect(patches).toHaveLength(1);
    expect(patches[0].status).toBe('applied');
    expect(patches[0].operation).toBe('set_factor_value');
    expect(patches[0].target_id).toBe('fac_x');
    expect(patches[0].before).toEqual({ value: 80 });
  });

  it('a designating key with a null value designates nothing', () => {
    // `analysis_result` REQUIRES `leading_option_id: string | null`, so an
    // honestly-withholding turn ships the key. Failing on the key NAME would
    // mark every correct withheld run as a violation.
    expect(valueDesignates(null)).toBe(false);
    expect(valueDesignates(undefined)).toBe(false);
    expect(valueDesignates('')).toBe(false);
    expect(valueDesignates([])).toBe(false);
    expect(valueDesignates({})).toBe(false);
    expect(valueDesignates(false)).toBe(false);
    // …and these DO designate. The number case is the harness's deliberate
    // strengthening over the producer's string-only egress alarm.
    expect(valueDesignates('opt_hire')).toBe(true);
    expect(valueDesignates(1)).toBe(true);
    expect(valueDesignates(0)).toBe(true);
    expect(valueDesignates({ band: 'slightly_ahead' })).toBe(true);
  });

  it('collectAllKeys carries the value, so the guard above can be applied', () => {
    const found = collectAllKeys(wireBody).find((k) => k.key === 'leading_option_id');
    expect(found).toBeDefined();
    expect(found?.value).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('C5 target binding — by identity, never by value', () => {
  function draftTurn(nodes: readonly Record<string, unknown>[]): readonly TurnCapture[] {
    return [
      {
        index: 0,
        probes: 'the brief',
        sent: { index: 0, message: '', sha256: '' },
        httpStatus: 200,
        elapsedMs: 0,
        body: { draft_graph: { nodes, edges: [] } } as never,
      },
    ];
  }

  const CORRECT = { id: 'fac_sales_headcount', type: 'factor', label: 'Sales headcount investment', value: 80 };
  /**
   * The DISCRIMINATING TWIN. A value predicate ("the factor whose value is 80")
   * matches this one too — the founder brief carries several quantities that
   * present as 80 — and it is NOT the object the conversation names.
   */
  const DECOY = { id: 'fac_other', type: 'factor', label: 'Weekly demo slots', value: 80 };

  it('resolves the named object uniquely, and does not pick the value-matching decoy', () => {
    const r = resolveTargetNode(draftTurn([DECOY, CORRECT]));
    expect(r.resolved).toBe(true);
    expect(r.nodeId).toBe('fac_sales_headcount');
  });

  it('deleting the named node makes the binding UNRESOLVED — it does not fall back to the decoy', () => {
    // The proof obligation: remove the object under test and the binding must
    // go dark, not silently succeed on something else.
    const r = resolveTargetNode(draftTurn([DECOY]));
    expect(r.resolved).toBe(false);
    expect(r.nodeId).toBeUndefined();
    expect(r.why).toContain('no node label matched');
  });

  it('refuses to guess when two labels tie, and prints the candidates', () => {
    const a = { id: 'fac_a', type: 'factor', label: 'Sales hire cost' };
    const b = { id: 'fac_b', type: 'factor', label: 'Sales hiring budget' };
    const r = resolveTargetNode(draftTurn([a, b]));
    expect(r.resolved).toBe(false);
    expect(r.why).toContain('tied');
    expect(r.candidates.map((c) => c.id).sort()).toEqual(['fac_a', 'fac_b']);
  });

  it('reports the absence of a drafted graph rather than resolving nothing quietly', () => {
    const r = resolveTargetNode(draftTurn([]));
    expect(r.resolved).toBe(false);
    expect(r.why).toContain('no drafted graph nodes');
  });
});

// ---------------------------------------------------------------------------

describe('the two hand-written pattern floors, in both directions', () => {
  it('the no-change denial family matches the producer literals it was sampled from', () => {
    // Lifted VERBATIM from src/orchestrator-v5/system-events/*. This is a
    // SAMPLED FLOOR, not a tracking mirror: a new phrasing added upstream is
    // NOT caught, and that limitation is the honest form.
    const producerLiterals = [
      "I couldn't remove that cleanly without leaving the model inconsistent, so I haven't changed anything.",
      "I can't change factor values right now. I haven't changed anything.",
      "There's no saved model I can safely update yet, so I haven't changed anything.",
      "I couldn't save that change. I haven't changed anything.",
      "I couldn't find that link in the current model, so I haven't changed anything. Reload the model and try again.",
    ];
    for (const literal of producerLiterals) {
      expect(findNoChangeDenial(literal), literal).not.toBeNull();
    }
  });

  it('the denial family does not fire on ordinary prose about change', () => {
    for (const clean of [
      'Updated Sales headcount investment from £80 to £100,000.',
      'That correction changed the ranking: founder-led selling moved from 33% to 61%.',
      'Nothing in the brief tells me how long ramp takes.',
    ]) {
      expect(findNoChangeDenial(clean), clean).toBeNull();
    }
  });

  it('the stability verdict floor fires on the verdict and not on ordinary English', () => {
    expect(findStabilityVerdict('The ranking is stable across the sweep.')).not.toBeNull();
    expect(findStabilityVerdict('Stable ranking')).not.toBeNull();
    expect(findStabilityVerdict('That is a robust result.')).not.toBeNull();
    // Ordinary adjectival use MUST keep passing — the producer's own
    // false-positive boundary ("robust" is not "robustness").
    expect(findStabilityVerdict('That looks like a robust plan to me.')).toBeNull();
    expect(findStabilityVerdict('Your revenue has been stable for six months.')).toBeNull();
  });
});
