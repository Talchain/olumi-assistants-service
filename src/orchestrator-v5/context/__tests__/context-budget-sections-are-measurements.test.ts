/**
 * `v5.context_budget` must be READABLE — RED-first for the "we cannot see what
 * we send our own models" defect (2026-09-17).
 *
 * Measured on real staging logs, three defects on the `draft_graph` call site
 * in one event:
 *
 *   site=draft_graph      total_chars=128    budget=None   in_tok=4506  chars_per_token=0.03
 *      section_chars: {"brief": "sha8:d8531659"}
 *   site=decision_review  total_chars=17823  budget=43100  in_tok=24094 chars_per_token=0.74
 *      section_chars: {"brief":"sha8:6934ec64","graph_json":7682, ...}
 *
 * 1. `section_chars.brief` emits a DIGEST where a COUNT belongs. The call site
 *    passes `effectiveBrief.length` (a number); the pino decision-content
 *    censor keys on the terminal field NAME, so a key named `brief` holding a
 *    LENGTH is digested exactly like a key named `brief` holding the TEXT.
 *    A length is shape-only — logger-config's own doctrine already rules the
 *    shape twins (`system_prompt_chars`, `system_prompt_sha256`) OFF the
 *    decision-content list because "redacting them would remove the detection
 *    surface and add no privacy". `section_chars` cannot express that rule by
 *    NAMING, because its keys ARE the policy's section names.
 *
 * 2. A char count cannot distinguish `<GRAPH>{}</GRAPH>` from a 20-node graph
 *    of the same size. The manifest (`section_shape`) can, and would have
 *    screamed on day one that the draft model was handed an empty graph.
 *
 * 3. `chars_per_token: 0.03` was already a working detector sitting unread
 *    beside 0.74 and 1.02 on the honest call sites. It must fail LOUD.
 *
 * POSITIVE CONTROL discipline (this file's sibling,
 * `utils/__tests__/logger-decision-content-redaction.test.ts`): every claim
 * that something is NOT redacted is paired with a proof that the same harness
 * DOES redact real decision content, so an absence can never be vacuous.
 */

import { afterEach, describe, expect, it } from 'vitest';
import pino from 'pino';

import { createLoggerConfig } from '../../../utils/logger-config.js';
import { runStageCoachingPass } from '../../../cee/unified-pipeline/stages/coaching-pass.js';
import type { StageContext } from '../../../cee/unified-pipeline/types.js';
import { setTestSink } from '../../../utils/telemetry.js';
import {
  CHARS_PER_TOKEN_PLAUSIBLE_MAX,
  CHARS_PER_TOKEN_PLAUSIBLE_MIN,
  TOTAL_CHARS_SCOPE,
  classifyCharsPerToken,
  emitContextBudget,
  jsonStructureManifest,
} from '../context-budget-telemetry.js';

/** High-entropy sentinel — cannot collide with service vocabulary. */
const BRIEF_SENTINEL = 'SENTINEL-4c1b9ee2-acquire-fintechco-for-50m';
const DIGEST_RE = /^sha8:[0-9a-f]{8}$/;

/** Build the PRODUCTION logger over an in-memory sink and return its lines. */
function captureProdLogger(): { logger: pino.Logger; lines: Record<string, unknown>[] } {
  const lines: Record<string, unknown>[] = [];
  const logger = pino(createLoggerConfig('info'), {
    write: (line: string) => {
      lines.push(JSON.parse(line) as Record<string, unknown>);
    },
  });
  return { logger, lines };
}

describe('v5.context_budget — section_chars must emit COUNTS, not digests', () => {
  it('leaves every section_chars value a finite NUMBER at the production logger boundary', () => {
    const { logger, lines } = captureProdLogger();

    // The exact shape `emitContextBudget` hands pino: emit() spreads the event
    // data at top level, so `section_chars` sits at depth 0 and its keys at
    // depth 1 — matched by the generated `*.brief` redact path.
    logger.info({
      event: 'v5.context_budget',
      call_site: 'draft_graph',
      section_chars: { brief: 1847 },
      total_chars: 1847,
    });
    logger.info({
      event: 'v5.context_budget',
      call_site: 'decision_review',
      section_chars: {
        brief: 1893,
        graph_json: 7682,
        isl_results: 8087,
        deterministic_coaching: 1520,
        decision_context: 317,
        flip_threshold_data: 60,
      },
      total_chars: 17823,
    });

    expect(lines).toHaveLength(2);
    for (const line of lines) {
      const sectionChars = line.section_chars as Record<string, unknown>;
      for (const [section, value] of Object.entries(sectionChars)) {
        expect(
          typeof value === 'number' && Number.isFinite(value),
          `section_chars.${section} on ${String(line.call_site)} must be a finite number, got ${JSON.stringify(value)}`,
        ).toBe(true);
      }
    }
    // Bind by IDENTITY, not by "some number is present": the SPECIFIC key the
    // live log destroyed must carry the SPECIFIC count the call site measured.
    expect((lines[0].section_chars as Record<string, unknown>).brief).toBe(1847);
    expect((lines[1].section_chars as Record<string, unknown>).brief).toBe(1893);
  });

  it('POSITIVE CONTROL — the same harness still digests real brief TEXT (the exemption is scoped to the measurement container, not to the name)', () => {
    const { logger, lines } = captureProdLogger();

    logger.info({ event: 'draft.started', brief: BRIEF_SENTINEL });
    logger.info({ event: 'draft.started', ctx: { brief: BRIEF_SENTINEL } });
    // A STRING under the measurement container is not a measurement — it must
    // still be digested, so the exemption cannot become a content bypass.
    logger.info({ event: 'v5.context_budget', section_chars: { brief: BRIEF_SENTINEL } });

    const raw = JSON.stringify(lines);
    expect(raw).not.toContain(BRIEF_SENTINEL);
    expect(String(lines[0].brief)).toMatch(DIGEST_RE);
    expect(String((lines[1].ctx as Record<string, unknown>).brief)).toMatch(DIGEST_RE);
    expect(String((lines[2].section_chars as Record<string, unknown>).brief)).toMatch(DIGEST_RE);
  });
});

describe('v5.context_budget — the DISCRIMINATING case: an empty structure must be distinguishable from a real one', () => {
  /**
   * The whole point. Two draft calls whose `graph` section serialises to the
   * SAME NUMBER OF CHARACTERS: one carries an empty graph, one carries a real
   * one. A char count cannot tell them apart; the manifest can.
   */
  const EMPTY_GRAPH_MANIFEST = { nodes: 0, edges: 0, constraints: 0 };
  const REAL_GRAPH_MANIFEST = { nodes: 20, edges: 31, constraints: 4 };
  const IDENTICAL_CHARS = 512;

  it('section_chars ALONE cannot discriminate (this is why the manifest exists)', () => {
    const { logger, lines } = captureProdLogger();
    logger.info({
      event: 'v5.context_budget',
      call_site: 'draft_graph',
      section_chars: { brief: 1847, graph: IDENTICAL_CHARS },
    });
    logger.info({
      event: 'v5.context_budget',
      call_site: 'draft_graph',
      section_chars: { brief: 1847, graph: IDENTICAL_CHARS },
    });
    expect(lines[0].section_chars).toEqual(lines[1].section_chars);
  });

  it('section_shape DOES discriminate, and survives the censor under content-named keys', () => {
    const { logger, lines } = captureProdLogger();

    logger.info({
      event: 'v5.context_budget',
      call_site: 'draft_graph',
      section_chars: { brief: 1847, graph: IDENTICAL_CHARS },
      section_shape: { brief: { chars: 1847 }, graph: EMPTY_GRAPH_MANIFEST },
    });
    logger.info({
      event: 'v5.context_budget',
      call_site: 'draft_graph',
      section_chars: { brief: 1847, graph: IDENTICAL_CHARS },
      section_shape: { brief: { chars: 1847 }, graph: REAL_GRAPH_MANIFEST },
    });

    const emptyShape = lines[0].section_shape as Record<string, unknown>;
    const realShape = lines[1].section_shape as Record<string, unknown>;

    // `brief` is a decision-content field NAME; nested under the measurement
    // container its manifest must survive whole rather than blank to
    // "[REDACTED]" — the live failure mode for any structured section.
    expect(emptyShape.brief).toEqual({ chars: 1847 });
    expect(emptyShape.graph).toEqual(EMPTY_GRAPH_MANIFEST);
    expect(realShape.graph).toEqual(REAL_GRAPH_MANIFEST);
    expect(emptyShape.graph).not.toEqual(realShape.graph);
    // The reading that would have screamed on day one.
    expect((emptyShape.graph as Record<string, number>).nodes).toBe(0);
  });
});

describe('v5.context_budget — chars_per_token must fail LOUD outside a plausible band', () => {
  it('classifies the three REAL measured values from staging', () => {
    // draft_graph, the broken site.
    expect(classifyCharsPerToken(0.03)).toBe('implausibly_low');
    // decision_review and the other honest site.
    expect(classifyCharsPerToken(0.74)).toBe('plausible');
    expect(classifyCharsPerToken(1.02)).toBe('plausible');
  });

  it('separates "not measured" from "measured and implausible"', () => {
    expect(classifyCharsPerToken(null)).toBe('unmeasurable');
    expect(classifyCharsPerToken(CHARS_PER_TOKEN_PLAUSIBLE_MAX + 0.01)).toBe('implausibly_high');
  });

  it('is INCLUSIVE at both band edges (a boundary must not read as a defect)', () => {
    expect(classifyCharsPerToken(CHARS_PER_TOKEN_PLAUSIBLE_MIN)).toBe('plausible');
    expect(classifyCharsPerToken(CHARS_PER_TOKEN_PLAUSIBLE_MAX)).toBe('plausible');
  });
});

describe('jsonStructureManifest — the reading a char count cannot give', () => {
  /**
   * The three renderings the enricher docs had to reason about by hand
   * (`coaching/decision-review-enricher.ts:121-134`): on staging,
   * `section_chars.graph_json` read 21, and only arithmetic over these three
   * established that the reviewing model had been sent NO GRAPH.
   */
  const ABSENT_GRAPH = '{}';
  const EMPTY_GRAPH = '{"nodes":[],"edges":[]}';
  const ONE_NODE_GRAPH = '{"nodes":[{"id":"n1"}],"edges":[]}';

  it('distinguishes the exact three cases the char count could not', () => {
    expect(jsonStructureManifest(ABSENT_GRAPH)).toEqual({ keys: 0 });
    expect(jsonStructureManifest(EMPTY_GRAPH)).toEqual({ nodes: 0, edges: 0, keys: 2 });
    expect(jsonStructureManifest(ONE_NODE_GRAPH)).toEqual({ nodes: 1, edges: 0, keys: 2 });
    // All three differ from each other — the discrimination, asserted directly.
    const readings = [ABSENT_GRAPH, EMPTY_GRAPH, ONE_NODE_GRAPH].map((g) =>
      JSON.stringify(jsonStructureManifest(g)),
    );
    expect(new Set(readings).size).toBe(3);
  });

  it('separates "could not read it" from "it was empty" — never a fabricated zero', () => {
    // Unreadable / absent: an EMPTY manifest, not `{nodes: 0}`.
    expect(jsonStructureManifest(null)).toEqual({});
    expect(jsonStructureManifest(undefined)).toEqual({});
    expect(jsonStructureManifest('')).toEqual({});
    expect(jsonStructureManifest('   ')).toEqual({});
    expect(jsonStructureManifest('not json at all')).toEqual({});
    expect(jsonStructureManifest('"a string"')).toEqual({});
    expect(jsonStructureManifest('42')).toEqual({});
    // Genuinely empty, and readable: a REAL zero.
    expect(jsonStructureManifest(EMPTY_GRAPH).nodes).toBe(0);
  });

  it('is total — arrays and nested objects never throw', () => {
    expect(jsonStructureManifest('[1,2,3]')).toEqual({ items: 3 });
    expect(jsonStructureManifest('{"a":{"b":1},"c":[1]}')).toEqual({ c: 1, keys: 2 });
  });

  it('emits a value the logger passes through unredacted (flat record of finite numbers)', () => {
    const { logger, lines } = captureProdLogger();
    logger.info({
      event: 'v5.context_budget',
      call_site: 'decision_review',
      section_shape: { brief: jsonStructureManifest(EMPTY_GRAPH) },
    });
    expect((lines[0].section_shape as Record<string, unknown>).brief).toEqual({
      nodes: 0,
      edges: 0,
      keys: 2,
    });
  });
});

describe('total_chars_scope — a number that measures a fraction must say so', () => {
  it('names draft_graph as the one site NOT counting the assembled user message', () => {
    expect(TOTAL_CHARS_SCOPE.draft_graph).toBe('declared_sections_only');
    for (const site of ['routing', 'edit_graph', 'repair_edit_graph', 'decision_review', 'draft_coaching'] as const) {
      expect(TOTAL_CHARS_SCOPE[site]).toBe('assembled_user_message');
    }
  });

  it('declares EVERY call site — a new one cannot go silently undeclared', () => {
    // Bound by identity to the telemetry call-site enum, not to a copy of it:
    // the record is keyed on ContextBudgetCallSite, so this is the runtime half
    // of a compile-time guarantee.
    expect(Object.keys(TOTAL_CHARS_SCOPE).sort()).toEqual(
      ['decision_review', 'draft_coaching', 'draft_graph', 'edit_graph', 'repair_edit_graph', 'routing'].sort(),
    );
  });
});

describe('emitContextBudget — the EMITTER must carry what the caller measured', () => {
  /**
   * ⚠ This block exists because a mutant survived without it. Replacing
   * `section_shape: args.section_shape ?? {}` with a hard-coded `{}` left the
   * whole suite GREEN: every other test here binds either the pure helper or
   * the logger boundary, and neither can see the emitter dropping its input on
   * the floor. Same shape as the estate's standing rule that an assertion must
   * bind to ITS OBJECT — here, to the seam that actually publishes the event.
   */
  const captured: { event: string; payload: Record<string, unknown> }[] = [];

  function capture(): void {
    captured.length = 0;
    setTestSink((event, payload) => {
      captured.push({ event, payload: payload as Record<string, unknown> });
    });
  }

  afterEach(() => {
    setTestSink(null);
  });

  function budgetEvent(): Record<string, unknown> {
    const events = captured.filter((c) => c.event === 'v5.context_budget');
    expect(events, 'precondition: exactly one v5.context_budget was emitted').toHaveLength(1);
    return events[0].payload;
  }

  const BASE = {
    model: 'test-model',
    prompt_version: null,
    prompt_hash: null,
    request_id: 'req-emitter-binding',
    scenario_id: null,
    truncations: [],
    summary_lag_turns: null,
    ui_narrowed: null,
  } as const;

  it('publishes the caller\'s section_shape verbatim — not an empty object', () => {
    capture();
    const manifest = { nodes: 0, edges: 0, keys: 2 };
    emitContextBudget({
      ...BASE,
      call_site: 'decision_review',
      section_chars: { brief: 1893, graph_json: 21 },
      section_shape: { graph_json: manifest },
      total_chars: 10647,
      usage: { input_tokens: 14000, output_tokens: 500 },
    });
    const payload = budgetEvent();
    expect(payload.section_shape).toEqual({ graph_json: manifest });
    // Bind by IDENTITY: the SPECIFIC reading that would have named the live
    // "no graph reached the reviewing model" defect on sight.
    expect((payload.section_shape as Record<string, Record<string, number>>).graph_json.nodes).toBe(0);
  });

  it('defaults section_shape to {} for a site that measures no structure — and still emits the key', () => {
    capture();
    emitContextBudget({
      ...BASE,
      call_site: 'routing',
      section_chars: { brief: 10 },
      total_chars: 10,
      usage: { input_tokens: 5, output_tokens: 1 },
    });
    const payload = budgetEvent();
    expect(payload).toHaveProperty('section_shape');
    expect(payload.section_shape).toEqual({});
  });

  it('carries the chars_per_token VERDICT, the total_chars SCOPE and the budget BASIS on the real draft_graph numbers', () => {
    capture();
    // The measured staging event, reproduced exactly.
    emitContextBudget({
      ...BASE,
      call_site: 'draft_graph',
      section_chars: { brief: 128 },
      section_shape: { brief: { chars: 128 } },
      total_chars: 128,
      usage: { input_tokens: 4506, output_tokens: 900 },
    });
    const payload = budgetEvent();
    expect(payload.chars_per_token).toBe(0.03);
    expect(payload.chars_per_token_verdict).toBe('implausibly_low');
    expect(payload.total_chars_scope).toBe('declared_sections_only');
    // "unbounded by design" must not look like "nobody set one".
    expect(payload.budget_chars).toBeNull();
    expect(payload.budget_basis).toBe('unbounded_by_design');
    expect((payload.section_chars as Record<string, unknown>).brief).toBe(128);
  });

  it('CONTRAST — decision_review reads healthy on the same fields, so the verdict is discriminating rather than constant', () => {
    capture();
    emitContextBudget({
      ...BASE,
      call_site: 'decision_review',
      section_chars: { brief: 1893, graph_json: 7682 },
      total_chars: 17823,
      usage: { input_tokens: 24094, output_tokens: 1200 },
    });
    const payload = budgetEvent();
    expect(payload.chars_per_token).toBe(0.74);
    expect(payload.chars_per_token_verdict).toBe('plausible');
    expect(payload.total_chars_scope).toBe('assembled_user_message');
    expect(payload.budget_chars).toBe(43100);
    expect(payload.budget_basis).toBe('budgeted');
  });
});

describe('ROUTE-LEVEL — the real coaching pass must PUBLISH a manifest that discriminates', () => {
  /**
   * ⚠ This block exists because two producer-site mutants SURVIVED without it:
   * replacing `section_shape: { graph: jsonStructureManifest(...) }` with `{}`
   * at the call sites left every suite in this repo green. A pure helper that
   * works and an emitter that forwards prove nothing about a CALL SITE that
   * never passes the value — the extractor-deletion obligation, applied here.
   *
   * It drives `runStageCoachingPass` for real and reads the emitted event, and
   * it runs the DISCRIMINATING PAIR through that same path: an empty graph and
   * a real one must produce DIFFERENT manifests. A single run would only prove
   * the field is populated, not that it carries information.
   */
  const captured: { event: string; payload: Record<string, unknown> }[] = [];

  afterEach(() => {
    setTestSink(null);
  });

  async function runPassWithGraph(graph: unknown): Promise<Record<string, unknown>> {
    captured.length = 0;
    setTestSink((event, payload) => {
      captured.push({ event, payload: payload as Record<string, unknown> });
    });
    const ctx = {
      coaching: undefined,
      draftAdapter: {
        chat: async () => ({
          content: '{"coaching":null,"causal_claims":[]}',
          model: 'test-coaching-model',
          usage: { input_tokens: 20, output_tokens: 8 },
        }),
      },
      graph,
      opts: { requestStartMs: Date.now(), signal: undefined },
      start: Date.now(),
      effectiveBrief: 'Should we hire locally or offshore? Budget GBP 250k.',
      requestId: 'req-manifest-route-level',
      input: { scenario_id: 'scen-manifest' },
      pipelineOutcome: {},
    } as unknown as StageContext;

    await runStageCoachingPass(ctx);

    const events = captured.filter(
      (c) =>
        c.event === 'v5.context_budget' &&
        (c.payload as { call_site?: string }).call_site === 'draft_coaching',
    );
    expect(events, 'precondition: the real pass emitted exactly one draft_coaching budget event').toHaveLength(1);
    return events[0].payload;
  }

  it('an EMPTY graph and a REAL graph reach the log as different manifests', async () => {
    const emptyPayload = await runPassWithGraph({ nodes: [], edges: [] });
    const realPayload = await runPassWithGraph({
      nodes: [
        { id: 'dec', kind: 'decision', label: 'Hire?' },
        { id: 'goal', kind: 'goal', label: 'Revenue' },
        { id: 'f1', kind: 'factor', label: 'Salary cost' },
      ],
      edges: [
        { from: 'dec', to: 'goal', weight: 0.7 },
        { from: 'f1', to: 'goal', weight: 0.3 },
      ],
    });

    const emptyShape = emptyPayload.section_shape as Record<string, Record<string, number>>;
    const realShape = realPayload.section_shape as Record<string, Record<string, number>>;

    // The reading that would have screamed on day one.
    expect(emptyShape.graph.nodes).toBe(0);
    expect(emptyShape.graph.edges).toBe(0);
    // Bind by IDENTITY to the counts the pass actually projected and SENT.
    expect(realShape.graph.nodes).toBe(3);
    expect(realShape.graph.edges).toBe(2);
    // The discrimination itself, asserted directly.
    expect(emptyShape.graph).not.toEqual(realShape.graph);
  });

  it('PRECONDITION — the char count alone is a far weaker signal than the manifest', async () => {
    const emptyPayload = await runPassWithGraph({ nodes: [], edges: [] });
    // A serialised empty graph still costs characters, so a non-zero
    // `section_chars.graph` is fully consistent with NOTHING being sent. That
    // is precisely the read that cost a human three hypothetical renderings of
    // arithmetic on the decision_review seam.
    const chars = (emptyPayload.section_chars as Record<string, number>).graph;
    expect(chars).toBeGreaterThan(0);
    expect((emptyPayload.section_shape as Record<string, Record<string, number>>).graph.nodes).toBe(0);
  });
});
