/**
 * P0 — the product must not ask a user to confirm a link the engine throws away.
 *
 * WITNESSED: a user asked for a risk of overspending and still missing the launch
 * date. The product proposed it, held it, the user approved, and it confirmed —
 * creating `option → risk` links. PLoT's `filterOptionNodes`
 * (`src/normalisation/option-filter.ts:91-96`) deletes every edge incident to an
 * option or decision node, so neither link ever reached the analysis, and nothing
 * told the user.
 *
 * RED-first at `a401cc9a` with the predicate module present and the wiring hunk
 * absent — the four wiring pins below fail with the recorded signatures.
 *
 * ⚠ THE REJECTED SENTENCE. A previous attempt (#1347) shipped "An option reaches a
 * risk through a factor", which is false: no edge out of an option survives. The
 * copy pin below asserts the shipped text makes no promise about a link of any
 * shape, so that class of sentence cannot come back unnoticed.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import {
  buildEngineDiscardedLinkRefusal,
  findEngineDiscardedLinks,
} from '../engine-discarded-link-gate.js';
import { evaluateEditGraphMutations } from '../edit-graph-referee-gate.js';
import { confirmationSatisfies } from '../gm-held-execute.js';
import {
  findForbiddenPhraseHit,
  findSuccessClaimHit,
} from '../../compose/forbidden-user-facing-phrases.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { ALLOWED_EDGES } from '../../../validators/graph-validator.types.js';
import * as telemetry from '../../../utils/telemetry.js';

// ── fixture: the witnessed shape ────────────────────────────────────────────

const GRAPH = {
  nodes: [
    { id: 'g-launch', kind: 'goal', label: 'Ship on time' },
    { id: 'd-choice', kind: 'decision', label: 'How to staff delivery' },
    { id: 'f-velocity', kind: 'factor', label: 'Delivery velocity', observed_state: { value: 0.4 } },
    { id: 'r-overspend', kind: 'risk', label: 'Overspend and still miss the date' },
    { id: 'oc-margin', kind: 'outcome', label: 'Programme margin' },
    { id: 'o-hire', kind: 'option', label: 'Hire more developers', interventions: { 'f-velocity': { value: 0.6 } } },
  ],
  edges: [
    { from: 'd-choice', to: 'o-hire', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'o-hire', to: 'f-velocity', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'f-velocity', to: 'oc-margin', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'f-velocity', to: 'r-overspend', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'oc-margin', to: 'g-launch', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'r-overspend', to: 'g-launch', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
  ],
};

function hashOf(graph: unknown): string {
  const h = computeAnalysisAffectingGraphHash(graph as never);
  if (h === null) throw new Error('fixture must hash');
  return h;
}

const edgeValue = (from: string, to: string) => ({
  from,
  to,
  strength: { mean: 0.5, std: 0.1 },
  exists_probability: 0.9,
  effect_direction: 'positive',
});

/** THE WITNESSED OP — an option linked straight at a risk. */
const OPTION_TO_RISK_OP = {
  op: 'add_edge',
  path: 'o-hire::r-overspend',
  value: edgeValue('o-hire', 'r-overspend'),
};

/** The LEGAL twin: the one option-incident shape `ALLOWED_EDGES` admits. */
const OPTION_TO_FACTOR_OP = {
  op: 'add_edge',
  path: 'o-hire::f-velocity',
  value: edgeValue('o-hire', 'f-velocity'),
};

/** A structural op with no option incidence at all. */
const FACTOR_TO_RISK_OP = {
  op: 'add_edge',
  path: 'f-velocity::r-overspend',
  value: edgeValue('f-velocity', 'r-overspend'),
};

function baseInput(overrides: Partial<Parameters<typeof evaluateEditGraphMutations>[0]> = {}) {
  const hash = hashOf(GRAPH);
  return {
    mode: 'live' as const,
    operations: [OPTION_TO_RISK_OP],
    currentGraph: GRAPH,
    currentGraphHash: hash,
    baseGraphHash: hash,
    freshness: 'none' as const,
    scenarioId: 'scn-p0',
    turnId: 'turn-p0',
    requestId: 'req-p0',
    ...overrides,
  };
}

let emitSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  emitSpy = vi.spyOn(telemetry, 'emit').mockImplementation(() => {});
});
afterEach(() => {
  emitSpy.mockRestore();
});

// ── the predicate ───────────────────────────────────────────────────────────

describe('findEngineDiscardedLinks — bound to the ENGINE rule, not to the case in hand', () => {
  it('the witnessed option -> risk link is found, and identifies the option endpoint by IDENTITY', () => {
    const found = findEngineDiscardedLinks([OPTION_TO_RISK_OP], GRAPH);
    expect(found).toHaveLength(1);
    expect(found[0]).toEqual({
      fromLabel: 'Hire more developers',
      toLabel: 'Overspend and still miss the date',
      strippedKind: 'option',
      strippedLabel: 'Hire more developers',
    });
  });

  it('the LEGAL option -> factor link is NOT found (the discriminating half of the pair)', () => {
    expect(findEngineDiscardedLinks([OPTION_TO_FACTOR_OP], GRAPH)).toHaveLength(0);
  });

  it('a link with no option or decision incidence is NOT found', () => {
    expect(findEngineDiscardedLinks([FACTOR_TO_RISK_OP], GRAPH)).toHaveLength(0);
  });

  it('a risk created in the SAME batch still resolves — the commonest shape of the P0', () => {
    const found = findEngineDiscardedLinks(
      [
        { op: 'add_node', path: 'r-new', value: { id: 'r-new', kind: 'risk', label: 'Budget overrun' } },
        { op: 'add_edge', path: 'o-hire::r-new', value: edgeValue('o-hire', 'r-new') },
      ],
      GRAPH,
    );
    expect(found).toHaveLength(1);
    expect(found[0]!.toLabel).toBe('Budget overrun');
  });

  it('endpoints carried only on the path (no value.from/to) still resolve', () => {
    const found = findEngineDiscardedLinks(
      [{ op: 'add_edge', path: 'o-hire::r-overspend', value: {} }],
      GRAPH,
    );
    expect(found).toHaveLength(1);
  });

  it('TOTAL: a hostile operations array contributes nothing rather than throwing', () => {
    expect(() =>
      findEngineDiscardedLinks(
        [
          { op: 'add_edge', path: 'no-separator', value: null } as never,
          { op: 'add_edge', path: 'ghost-a::ghost-b', value: edgeValue('ghost-a', 'ghost-b') },
        ],
        GRAPH,
      ),
    ).not.toThrow();
    expect(
      findEngineDiscardedLinks(
        [{ op: 'add_edge', path: 'ghost-a::ghost-b', value: edgeValue('ghost-a', 'ghost-b') }],
        GRAPH,
      ),
    ).toHaveLength(0);
  });
});

// ── the NAMED RESIDUAL, as an exact set (REDs if it grows OR shrinks) ───────

describe('the residual is pinned exactly, not left invisible', () => {
  const KINDS = ['decision', 'option', 'factor', 'outcome', 'risk', 'goal'] as const;

  /** Every OPTION-incident kind pair the gate lets through. */
  const admittedIncidentPairs = () => {
    const out: string[] = [];
    for (const from of KINDS) {
      for (const to of KINDS) {
        const incident = from === 'option' || to === 'option';
        if (!incident) continue;
        const graph = {
          nodes: [
            { id: 'n-from', kind: from, label: 'From node' },
            { id: 'n-to', kind: to, label: 'To node' },
          ],
        };
        const fired = findEngineDiscardedLinks(
          [{ op: 'add_edge', path: 'n-from::n-to', value: edgeValue('n-from', 'n-to') }],
          graph,
        );
        if (fired.length === 0) out.push(`${from}->${to}`);
      }
    }
    return out.sort();
  };

  it('EXACTLY two option-incident shapes pass the gate, and they are the two ALLOWED_EDGES admits', () => {
    expect(admittedIncidentPairs()).toEqual(['decision->option', 'option->factor']);
  });

  it('the pass-list is DERIVED from ALLOWED_EDGES, not hand-listed beside it', () => {
    const fromMatrix = ALLOWED_EDGES.filter(
      (r) => r.fromKind === 'option' || r.toKind === 'option',
    )
      .map((r) => `${r.fromKind}->${r.toKind}`)
      .sort();
    expect(admittedIncidentPairs()).toEqual(fromMatrix);
  });

  it('RESIDUAL, stated: a DECISION-incident link with no option does NOT fire, because this gate\'s question would not fit it', () => {
    const graph = {
      nodes: [
        { id: 'f-x', kind: 'factor', label: 'A factor' },
        { id: 'd-x', kind: 'decision', label: 'A decision' },
      ],
    };
    expect(
      findEngineDiscardedLinks(
        [{ op: 'add_edge', path: 'f-x::d-x', value: edgeValue('f-x', 'd-x') }],
        graph,
      ),
    ).toHaveLength(0);
  });

  it('every link the gate DOES report has an option endpoint, so the copy\'s question always fits', () => {
    for (const from of KINDS) {
      for (const to of KINDS) {
        const graph = {
          nodes: [
            { id: 'n-from', kind: from, label: 'From node' },
            { id: 'n-to', kind: to, label: 'To node' },
          ],
        };
        for (const link of findEngineDiscardedLinks(
          [{ op: 'add_edge', path: 'n-from::n-to', value: edgeValue('n-from', 'n-to') }],
          graph,
        )) {
          expect(link.strippedKind, `${from}->${to}`).toBe('option');
        }
      }
    }
  });

  it('RESIDUAL, stated: option -> factor passes WHATEVER the factor category, including observable', () => {
    const graph = {
      nodes: [
        { id: 'o-x', kind: 'option', label: 'An option' },
        { id: 'f-obs', kind: 'factor', label: 'An observable factor', category: 'observable' },
      ],
    };
    expect(
      findEngineDiscardedLinks(
        [{ op: 'add_edge', path: 'o-x::f-obs', value: edgeValue('o-x', 'f-obs') }],
        graph,
      ),
    ).toHaveLength(0);
  });
});

// ── the copy: every clause, and the sentence that must never return ─────────

describe('the refusal copy is true of the engine, and promises no link', () => {
  const TEXT = buildEngineDiscardedLinkRefusal(findEngineDiscardedLinks([OPTION_TO_RISK_OP], GRAPH));

  it('names the link it refused, by identity', () => {
    expect(TEXT).toContain("the link from 'Hire more developers' to 'Overspend and still miss the date'");
  });

  it('states that nothing was put in the model', () => {
    expect(TEXT).toContain('I have not put');
  });

  it('states the engine rule that makes the link futile', () => {
    expect(TEXT).toContain('A link that starts or ends at an option is dropped before the analysis runs');
  });

  it('asks the answerable question — which factor, and by how much', () => {
    expect(TEXT).toContain("Tell me which factor 'Hire more developers' changes and by how much");
  });

  it('hands over the ONE phrasing that routes, option deliberately unnamed', () => {
    expect(TEXT).toContain('"Set the option\'s effect on that factor to 0.6"');
  });

  it('⚠ makes NO promise to build a link of any shape — the #1347 rejection class', () => {
    expect(TEXT).not.toMatch(/\bthrough a factor\b/i);
    expect(TEXT).not.toMatch(/\bconnect\b/i);
    expect(TEXT).not.toMatch(/\bI(?:'ll| will)\s+(?:add|create|link|wire)\b/i);
    expect(TEXT).not.toMatch(/\binstead I\b/i);
  });

  it('claims nothing about the goal, the numbers it would produce, or what 0.0 means', () => {
    expect(TEXT).not.toMatch(/\boptimistic\b/i);
    expect(TEXT).not.toMatch(/\bzero\b/i);
    expect(TEXT).not.toMatch(/\bprobability\b/i);
  });

  it('survives both egress guards and carries no em dash', () => {
    expect(findSuccessClaimHit(TEXT)).toBeNull();
    expect(findForbiddenPhraseHit(TEXT)).toBeNull();
    expect(TEXT).not.toContain('—');
  });

  it('a multi-link batch says so and refuses the whole thing', () => {
    const text = buildEngineDiscardedLinkRefusal(
      findEngineDiscardedLinks(
        [
          OPTION_TO_RISK_OP,
          { op: 'add_edge', path: 'o-hire::g-launch', value: edgeValue('o-hire', 'g-launch') },
        ],
        GRAPH,
      ),
    );
    expect(text).toContain('1 other link in this change');
    expect(text).toContain('left the whole change out rather than apply part of it');
    expect(findSuccessClaimHit(text)).toBeNull();
    expect(findForbiddenPhraseHit(text)).toBeNull();
  });

  it('falls back to unnamed copy when no label is safe to render, and still refuses', () => {
    const graph = { nodes: [{ id: 'o-x', kind: 'option' }, { id: 'r-x', kind: 'risk' }] };
    const links = findEngineDiscardedLinks(
      [{ op: 'add_edge', path: 'o-x::r-x', value: edgeValue('o-x', 'r-x') }],
      graph,
    );
    expect(links).toHaveLength(1);
    const text = buildEngineDiscardedLinkRefusal(links);
    expect(text).toContain('I have not put that link in the model');
    expect(text).toContain('Tell me which factor that option changes');
    expect(findForbiddenPhraseHit(text)).toBeNull();
  });
});

// ── the wiring: RED-first at pristine ───────────────────────────────────────

describe('evaluateEditGraphMutations refuses instead of holding it for confirmation', () => {
  it('option -> risk: governing is clarify_required, NOT held', () => {
    const d = evaluateEditGraphMutations(baseInput());
    expect(d.governing).toBe('clarify_required');
  });

  it('option -> risk: nothing applies, and there is NO chip and NO pending to confirm', () => {
    const d = evaluateEditGraphMutations(baseInput());
    expect(d.blockApply).toBe(true);
    expect(d.suggestedActions).toEqual([]);
    expect(d.pendingActions).toBeNull();
  });

  it('option -> risk: the user sees the refusal, not the generic hold ask', () => {
    const d = evaluateEditGraphMutations(baseInput());
    expect(d.assistantText).toBe(
      buildEngineDiscardedLinkRefusal(findEngineDiscardedLinks([OPTION_TO_RISK_OP], GRAPH)),
    );
    expect(d.assistantText).not.toContain('Reply yes to continue');
  });

  it('option -> risk: a confirm cannot satisfy the verdict, so the resume path cannot apply it', () => {
    const d = evaluateEditGraphMutations(baseInput({ dispatchPath: 'gm_held_resume' }));
    expect(confirmationSatisfies(d.governing)).toBe(false);
  });

  it('the public reason names the real blocker rather than a plain structural hold', () => {
    const d = evaluateEditGraphMutations(baseInput());
    expect(d.publicReason).toMatchObject({
      source: 'graph_management',
      verdict: 'clarify_required',
      blocker_code: 'ENGINE_DISCARDS_OPTION_LINK',
    });
  });

  it('MIXED batch (one legal option -> factor, one illegal option -> risk) refuses WHOLE', () => {
    const d = evaluateEditGraphMutations(
      baseInput({ operations: [OPTION_TO_FACTOR_OP, OPTION_TO_RISK_OP] }),
    );
    expect(d.governing).toBe('clarify_required');
    expect(d.pendingActions).toBeNull();
    expect(d.suggestedActions).toEqual([]);
  });

  // ── the discriminating twin: the gate must not swallow the ordinary hold ──

  it('LEGAL-ONLY batch (option -> factor) is STILL held, with its chip and pending intact', () => {
    const d = evaluateEditGraphMutations(baseInput({ operations: [OPTION_TO_FACTOR_OP] }));
    expect(d.governing).toBe('held');
    expect(d.assistantText).toContain('Nothing in the model moves until you confirm');
    expect(d.suggestedActions).toHaveLength(1);
    expect(d.pendingActions).toHaveLength(1);
  });

  it('a structural batch with no option incidence is STILL held, unchanged', () => {
    const d = evaluateEditGraphMutations(baseInput({ operations: [FACTOR_TO_RISK_OP] }));
    expect(d.governing).toBe('held');
    expect(d.pendingActions).toHaveLength(1);
  });

  it('an UNRESOLVED endpoint kind falls through to the ordinary hold rather than asserting a harm', () => {
    const found = findEngineDiscardedLinks(
      [{ op: 'add_edge', path: 'o-hire::ghost', value: edgeValue('o-hire', 'ghost') }],
      GRAPH,
    );
    expect(found).toHaveLength(0);
  });

  it('a REJECTED batch keeps its own refusal — the gate does not hijack a verdict that outranks held', () => {
    const collision = {
      op: 'add_node',
      path: 'f-velocity',
      value: { id: 'f-velocity', kind: 'factor', label: 'Delivery velocity' },
    };
    const d = evaluateEditGraphMutations(
      baseInput({ operations: [collision, OPTION_TO_RISK_OP] }),
    );
    expect(d.governing).toBe('rejected');
    expect(d.publicReason).toMatchObject({ blocker_code: 'ENTITY_ID_COLLISION' });
  });

  it('SHADOW mode stays log-only — the gate never changes a shadow outcome', () => {
    const d = evaluateEditGraphMutations(baseInput({ mode: 'shadow' }));
    expect(d.blockApply).toBe(false);
    expect(d.assistantText).toBeNull();
  });
});
