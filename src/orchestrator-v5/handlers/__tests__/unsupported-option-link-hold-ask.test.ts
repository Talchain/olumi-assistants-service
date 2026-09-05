/**
 * UNSUPPORTED OPTION LINK — the consent ask must not confirm a link the
 * engine will discard.
 *
 * THE CAPTURED DEFECT (real user, 2026-09). The user asked for "a risk of
 * spending more money on development resources and still not hitting our
 * launch date". The product proposed, held, the user confirmed, and it
 * replied:
 *
 *   "Confirmed: add risk 'Spend on resources without hitting launch date',
 *    link 'Hire a Tech Lead' to it, link 'Two Developers' to it, and link
 *    it to 'Boost Productivity'."
 *
 * Two of those three links are `option -> risk`, a shape the platform's own
 * edge matrix does not carry (`ALLOWED_EDGES`,
 * src/validators/graph-validator.types.ts:293-302, whose ONLY `option` rule
 * is `option -> factor(controllable)` at :295; the draft prompt lists
 * `option -> risk (options work through factors)` among prohibited patterns
 * at src/prompts/defaults.ts:246). The interactive `edit_graph` path applies
 * only `validateGraphStructure`, whose whole vocabulary
 * (graph-structure-validator.ts:90-100) carries NO edge-shape code, so the
 * batch validates CLEAN and persists. PLoT then removes every edge incident
 * to an `option` node before the compute (`filterOptionNodes`,
 * plot-lite-service src/normalisation/option-filter.ts:60-97 — "Removes ALL
 * edges incident to those nodes", unconditional).
 *
 * So the ask named three links, the user said yes, and two of them never
 * reached the result. These pins are RED-first: nothing in
 * `unsupported-option-link.ts` exists on the pre-fix base.
 *
 * TWO QUESTIONS, NAMED APART (trap 21). `classifyAddRiskToOptionRejection`
 * (add-risk-rejection-guidance.ts:93) answers "a structural violation ALREADY
 * occurred and is reachability-class, should the generic REJECTION copy be
 * replaced?" — its Gate 1 returns null on `newViolations.length === 0`. This
 * module answers "this edit will be ACCEPTED, will part of it be discarded
 * before the calculation?" Its precondition is a CLEAN validation. The two
 * predicates are disjoint by construction and neither is widened to cover
 * the other; `disjointness` below pins that.
 */

import { describe, expect, it } from 'vitest';

import {
  buildGmUnsupportedLinkHeldAssistantText,
  classifyUnsupportedOptionLinks,
  GM_UNSUPPORTED_LINK_HELD_ASSISTANT_TEXT,
  type UnsupportedOptionLinkMatch,
} from '../unsupported-option-link.js';
import { describeHeldOperationsSubject } from '../describe-changeset.js';
import {
  findForbiddenPhraseHit,
  findSuccessClaimHit,
  HELD_SCIENCE_VOCABULARY_PATTERN,
} from '../../compose/forbidden-user-facing-phrases.js';
import { classifyAddRiskToOptionRejection } from '../../../orchestrator/add-risk-rejection-guidance.js';
import { validateGraphStructure } from '../../../orchestrator/graph-structure-validator.js';
import { ALLOWED_EDGES } from '../../../validators/graph-validator.types.js';

// ---------------------------------------------------------------------------
// The captured graph, by IDENTITY (node ids), not by value predicate.
// ---------------------------------------------------------------------------

const OPT_LEAD = 'opt-tech-lead';
const OPT_DEVS = 'opt-two-devs';
const FAC_VELOCITY = 'fac-velocity';
const GOAL_BOOST = 'goal-boost-productivity';
const DEC_ROOT = 'dec-root';
const RISK_SPEND = 'risk-spend-no-launch';

const LABEL_LEAD = 'Hire a Tech Lead';
const LABEL_DEVS = 'Two Developers';
const LABEL_RISK = 'Spend on resources without hitting launch date';
const LABEL_FACTOR = 'Delivery velocity';

/** The PRE-edit graph the user actually had on screen. */
const GRAPH = {
  nodes: [
    { id: DEC_ROOT, kind: 'decision', label: 'How to hit the launch date' },
    { id: OPT_LEAD, kind: 'option', label: LABEL_LEAD },
    { id: OPT_DEVS, kind: 'option', label: LABEL_DEVS },
    { id: FAC_VELOCITY, kind: 'factor', label: LABEL_FACTOR, category: 'controllable' },
    { id: GOAL_BOOST, kind: 'goal', label: 'Boost Productivity' },
  ],
  edges: [
    { from: DEC_ROOT, to: OPT_LEAD },
    { from: DEC_ROOT, to: OPT_DEVS },
    { from: OPT_LEAD, to: FAC_VELOCITY },
    { from: OPT_DEVS, to: FAC_VELOCITY },
    { from: FAC_VELOCITY, to: GOAL_BOOST },
  ],
};

/**
 * The captured batch: the risk is added and wired IN THE SAME BATCH, so its
 * kind is resolvable only from the batch's own `add_node`, never from the
 * pre-edit graph. A classifier that reads kinds from `GRAPH` alone sees
 * nothing here.
 */
const CAPTURED_OPS = [
  {
    op: 'add_node',
    path: RISK_SPEND,
    value: { id: RISK_SPEND, kind: 'risk', label: LABEL_RISK },
  },
  { op: 'add_edge', path: `${OPT_LEAD}->${RISK_SPEND}`, value: { from: OPT_LEAD, to: RISK_SPEND } },
  { op: 'add_edge', path: `${OPT_DEVS}->${RISK_SPEND}`, value: { from: OPT_DEVS, to: RISK_SPEND } },
  { op: 'add_edge', path: `${RISK_SPEND}->${GOAL_BOOST}`, value: { from: RISK_SPEND, to: GOAL_BOOST } },
];

/** The supported shape: an option linked to a CONTROLLABLE factor. */
const LEGAL_OPS = [
  {
    op: 'add_edge',
    path: `${OPT_LEAD}->${FAC_VELOCITY}`,
    value: { from: OPT_LEAD, to: FAC_VELOCITY },
  },
];

// ---------------------------------------------------------------------------
// Premise pins — the facts the fix rests on. If any of these flips, the fix
// is aimed at the wrong seam and must be re-derived, not patched.
// ---------------------------------------------------------------------------

describe('premise: option -> risk is unsupported AND invisible to the interactive path', () => {
  it('ALLOWED_EDGES has exactly one option rule, and it is option -> factor(controllable)', () => {
    const optionRules = ALLOWED_EDGES.filter((r) => r.fromKind === 'option');
    expect(optionRules).toHaveLength(1);
    expect(optionRules[0]).toEqual({
      fromKind: 'option',
      toKind: 'factor',
      toFactorCategory: 'controllable',
    });
    expect(ALLOWED_EDGES.some((r) => r.fromKind === 'option' && r.toKind === 'risk')).toBe(false);
  });

  it('validateGraphStructure reports ZERO violations on the captured post-edit graph', () => {
    // This is why nothing else catches it: the graph is structurally clean.
    const post = {
      nodes: [...GRAPH.nodes, { id: RISK_SPEND, kind: 'risk', label: LABEL_RISK }],
      edges: [
        ...GRAPH.edges,
        { from: OPT_LEAD, to: RISK_SPEND },
        { from: OPT_DEVS, to: RISK_SPEND },
        { from: RISK_SPEND, to: GOAL_BOOST },
      ],
    };
    const result = validateGraphStructure(post as never);
    expect(result.violations.map((v) => v.code)).toEqual([]);
    expect(result.valid).toBe(true);
  });
});

describe('disjointness: the add-risk rejection classifier cannot see this case', () => {
  it('classifyAddRiskToOptionRejection returns null on a clean validation (zero violations)', () => {
    const post = {
      nodes: [...GRAPH.nodes, { id: RISK_SPEND, kind: 'risk', label: LABEL_RISK }],
      edges: [
        ...GRAPH.edges,
        { from: OPT_LEAD, to: RISK_SPEND },
        { from: RISK_SPEND, to: GOAL_BOOST },
      ],
    };
    expect(classifyAddRiskToOptionRejection(post as never, [], CAPTURED_OPS)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The classifier.
// ---------------------------------------------------------------------------

describe('classifyUnsupportedOptionLinks', () => {
  it('matches the captured batch and names BOTH options and the risk by node identity', () => {
    const match = classifyUnsupportedOptionLinks(CAPTURED_OPS, GRAPH);
    expect(match).not.toBeNull();
    const m = match as UnsupportedOptionLinkMatch;
    // Bound by id, then reported by label — a value predicate on the label
    // alone could be satisfied by a different node.
    expect(m.links.map((l) => l.fromId)).toEqual([OPT_LEAD, OPT_DEVS]);
    expect(m.links.map((l) => l.toId)).toEqual([RISK_SPEND, RISK_SPEND]);
    expect(m.optionLabels).toEqual([LABEL_LEAD, LABEL_DEVS]);
    expect(m.targetLabels).toEqual([LABEL_RISK]);
    expect(m.targetKindWord).toBe('risk');
  });

  it('resolves the target kind from an add_node EARLIER IN THE SAME BATCH', () => {
    // Drop the add_node and the risk kind is unknowable → no match. This
    // pins that the match above came from the batch, not from GRAPH.
    const withoutAdd = CAPTURED_OPS.filter((o) => o.op !== 'add_node');
    expect(classifyUnsupportedOptionLinks(withoutAdd, GRAPH)).toBeNull();
  });

  it('a LEGAL option -> factor(controllable) link returns null (must still confirm cleanly)', () => {
    expect(classifyUnsupportedOptionLinks(LEGAL_OPS, GRAPH)).toBeNull();
  });

  it('a mixed batch names ONLY the unsupported link, never the legal one', () => {
    const mixed = [...LEGAL_OPS, ...CAPTURED_OPS];
    const match = classifyUnsupportedOptionLinks(mixed, GRAPH);
    expect(match).not.toBeNull();
    const m = match as UnsupportedOptionLinkMatch;
    // The legal option->factor edge is absent from the match set entirely.
    expect(m.links.some((l) => l.toId === FAC_VELOCITY)).toBe(false);
    expect(m.links.map((l) => `${l.fromId}->${l.toId}`)).toEqual([
      `${OPT_LEAD}->${RISK_SPEND}`,
      `${OPT_DEVS}->${RISK_SPEND}`,
    ]);
  });

  it('a batch with no add_edge at all returns null', () => {
    expect(
      classifyUnsupportedOptionLinks(
        [{ op: 'update_node', path: FAC_VELOCITY, value: { description: 'x' } }],
        GRAPH,
      ),
    ).toBeNull();
  });

  it('scope is stated: option -> {risk, outcome, goal}; option -> factor is NOT this question', () => {
    // option -> goal is the same prohibited class ("options work through
    // factors", defaults.ts:246-248) and matches.
    const toGoal = [
      { op: 'add_edge', path: `${OPT_LEAD}->${GOAL_BOOST}`, value: { from: OPT_LEAD, to: GOAL_BOOST } },
    ];
    const m = classifyUnsupportedOptionLinks(toGoal, GRAPH);
    expect(m).not.toBeNull();
    expect((m as UnsupportedOptionLinkMatch).targetKindWord).toBe('goal');

    // option -> factor of the WRONG category is a DIFFERENT remedy (change
    // the category, or pick another factor), so it is deliberately not this
    // predicate's business. Widening to cover it would merge two questions.
    const observableGraph = {
      nodes: [
        ...GRAPH.nodes.filter((n) => n.id !== FAC_VELOCITY),
        { id: FAC_VELOCITY, kind: 'factor', label: LABEL_FACTOR, category: 'observable' },
      ],
      edges: GRAPH.edges,
    };
    expect(classifyUnsupportedOptionLinks(LEGAL_OPS, observableGraph)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The ask. THIS is the deliverable: the exact words the user now sees.
// ---------------------------------------------------------------------------

describe('buildGmUnsupportedLinkHeldAssistantText', () => {
  const match = classifyUnsupportedOptionLinks(CAPTURED_OPS, GRAPH) as UnsupportedOptionLinkMatch;
  const subject = describeHeldOperationsSubject(CAPTURED_OPS, GRAPH);
  const ask = buildGmUnsupportedLinkHeldAssistantText(match, subject, CAPTURED_OPS.length);

  it('is the exact sentence the captured user would now see', () => {
    expect(ask).toBe(
      "I'm holding these changes rather than applying them straight away: " +
        "add risk 'Spend on resources without hitting launch date', " +
        "link 'Hire a Tech Lead' to 'Spend on resources without hitting launch date', " +
        "link 'Two Developers' to 'Spend on resources without hitting launch date' and " +
        "link 'Spend on resources without hitting launch date' to 'Boost Productivity'. " +
        'One thing to settle first: a link straight from an option to a risk is not a shape ' +
        'this model can work with, so the links from ' +
        "'Hire a Tech Lead' and 'Two Developers' would sit in the model without reaching the " +
        'result. An option reaches a risk through a factor. Tell me which factor they change ' +
        "that makes 'Spend on resources without hitting launch date' more likely and I will " +
        'connect it that way instead, or reply yes to add it exactly as described.',
    );
  });

  it('names the risk the user asked for, and both options, verbatim', () => {
    expect(ask).toContain(LABEL_RISK);
    expect(ask).toContain(LABEL_LEAD);
    expect(ask).toContain(LABEL_DEVS);
  });

  it('offers the supported shape and does not present the discarded links as effective', () => {
    expect(ask).toContain('An option reaches a risk through a factor.');
    expect(ask).toContain('without reaching the result');
  });

  it('does not block the user: a yes is still explicitly available', () => {
    expect(ask).toContain('reply yes to add it exactly as described');
  });

  it('single unsupported link renders singular copy', () => {
    const oneOps = [CAPTURED_OPS[0]!, CAPTURED_OPS[1]!];
    const oneMatch = classifyUnsupportedOptionLinks(oneOps, GRAPH) as UnsupportedOptionLinkMatch;
    const oneAsk = buildGmUnsupportedLinkHeldAssistantText(
      oneMatch,
      describeHeldOperationsSubject(oneOps, GRAPH),
      oneOps.length,
    );
    expect(oneAsk).toContain("so the link from 'Hire a Tech Lead' would sit in the model");
    expect(oneAsk).toContain("which factor it changes");
    expect(oneAsk).not.toContain('the links from');
  });

  it('falls back to the generic swept ask when no subject is safe', () => {
    expect(buildGmUnsupportedLinkHeldAssistantText(match, null, 4)).toBe(
      GM_UNSUPPORTED_LINK_HELD_ASSISTANT_TEXT,
    );
  });

  it('the generic fallback still states the shape and the consequence', () => {
    expect(GM_UNSUPPORTED_LINK_HELD_ASSISTANT_TEXT).toContain('through a factor');
    expect(GM_UNSUPPORTED_LINK_HELD_ASSISTANT_TEXT).toContain('reply yes');
  });
});

describe('copy sweeps (provisional_doctrine_v0)', () => {
  const match = classifyUnsupportedOptionLinks(CAPTURED_OPS, GRAPH) as UnsupportedOptionLinkMatch;
  const texts = [
    GM_UNSUPPORTED_LINK_HELD_ASSISTANT_TEXT,
    buildGmUnsupportedLinkHeldAssistantText(
      match,
      describeHeldOperationsSubject(CAPTURED_OPS, GRAPH),
      CAPTURED_OPS.length,
    ),
  ];

  it('claims no success and trips no forbidden user-facing phrase', () => {
    for (const t of texts) {
      expect(findSuccessClaimHit(t)).toBeNull();
      expect(findForbiddenPhraseHit(t)).toBeNull();
    }
  });

  it('uses no held-science vocabulary and no em dash', () => {
    for (const t of texts) {
      expect(HELD_SCIENCE_VOCABULARY_PATTERN.test(t)).toBe(false);
      expect(t).not.toContain('—');
    }
  });

  it('leaks no internal vocabulary (node / edge / operation)', () => {
    for (const t of texts) {
      expect(/\bnodes?\b/i.test(t)).toBe(false);
      expect(/\bedges?\b/i.test(t)).toBe(false);
      expect(/\boperations?\b/i.test(t)).toBe(false);
    }
  });
});
