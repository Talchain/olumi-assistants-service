/**
 * LINK-TRACK R1 item 1 (contradiction cluster, C1) — THE "LIGHT ON DETAIL"
 * GUARD IS BLIND ON THE PATH THE PRODUCT ACTUALLY WALKS.
 *
 * ── WHAT WAS RE-DERIVED, AND WHY THIS FILE EXISTS ──────────────────────────
 * ROADMAP 2.972(c) (#873, merged 2026-08-08) added a guard: the draft
 * narrative must not tell a user their brief was light on detail when their
 * brief states amounts. `src/cee/provenance/__tests__/brief-completeness-claim.test.ts`
 * pins it, and pins it for B2 BY NAME.
 *
 * The guard was LIVE on 2026-08-11 and the sentence still shipped. Measured by
 * the L3 browser lane driving deployed staging with B2
 * (`olumi-docs/PHASE0-EVIDENCE-2026-07-28/arch-decision-2026-08-11/L3-BROWSER-TRUTH.md`
 * §5 C1): the draft summary opened "Your brief was light on detail, so adding
 * specifics will make the comparison more reliable." while the retention
 * receipt on the same session reported "I found 30 stated figures."
 *
 * ROOT CAUSE, derived at the bytes at `75516366` and NOT named by the evidence:
 * the guard is fed `briefText: payload.message` (draft-graph-dispatch.ts:243).
 * On the ordinary draft turn that IS the brief. But B2 goes through the
 * clarify-v2 intake gate, which PROCEEDs by dispatching the draft with
 * `briefOverride: decision.brief` (clarify-v2-dispatch.ts:382/461, threaded at
 * route-v2.ts:3649). On THAT turn `payload.message` is the user's one-line
 * intake answer ("Use sensible defaults" / "Success = ... Go ahead."), which
 * states no amounts — so `findStatedAmounts` returns empty and the advisory is
 * KEPT. The existing suite cannot see this: it calls the narrative builder
 * directly with the brief in hand, so it never exercises the seam where the
 * brief is somewhere else.
 *
 * The dispatcher already computes the right value one screen further down —
 * `const effectiveBrief = params.briefOverride ?? payload.message` (:436), the
 * SAME value it drafts from. The composer simply was not given it.
 *
 * This is CLAUDE.md trap 22's shape ("verify WHAT STRING THE GUARD ACTUALLY
 * RECEIVES, not that it is present and correct") and trap 16's ("a capture
 * proves what it was pointed at" — the 2.972 suite was pointed at the builder,
 * not the seam).
 *
 * ── HOW THIS PINS IT ───────────────────────────────────────────────────────
 * The brief text is passed as the 5th argument. At pristine the parameter does
 * not exist and the extra argument is ignored.
 *
 * ⚠ MEASURED AT PRISTINE, AND IT IS ITSELF A FINDING: only the "Use sensible
 * defaults" case REDs. The `Success = ... Q3 2027 ... one compulsory round
 * max.` variant PASSES at pristine — by accident, because that particular
 * intake answer happens to carry a date and a number, so `findStatedAmounts`
 * fires on the ANSWER and suppresses the advisory for a reason that has
 * nothing to do with the user's brief. **Whether the product insults a user's
 * brief currently depends on whether their one-line intake answer happens to
 * contain a digit.** Both cases are kept: one as the RED discriminator, one to
 * stop the accidental pass silently becoming the mechanism.
 *
 * The third case is the discriminating positive: a genuinely quantity-free
 * brief on the same path must KEEP the advisory, so the fix cannot pass by
 * suppressing the sentence unconditionally.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, it, expect, vi } from 'vitest';

// emit() is telemetry-only; silence it so the composer runs side-effect-free.
vi.mock('../../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/telemetry.js')>();
  return { ...actual, emit: vi.fn() };
});

import { draftResultToOlumiResponse } from '../draft-graph-dispatch.js';
import type { DraftGraphResult } from '../../../orchestrator/tools/draft-graph.js';
import { BRIEF_TEXT_AS_PERSISTED } from '../../../cee/provenance/__tests__/fixtures/trace-captures.js';

/** The exact sentence measured on deployed staging. Pinned verbatim. */
const THIN_SENTENCE = 'Your brief was light on detail';

/**
 * The intake answer B2's user actually sent on the turn that drafted the
 * graph. Not authored here — it is the tail the trace shows CEE concatenating
 * onto the persisted brief (`trace-captures.ts` header), i.e. the bytes that
 * arrived as `payload.message` while the real brief travelled as
 * `briefOverride`.
 */
const B2_INTAKE_ANSWER =
  'Success = EBITDA breakeven by Q3 2027 while keeping the redundancy promise — one compulsory round max. Go ahead.';

const GRAPH = {
  nodes: [
    { id: 'dec_opex', kind: 'decision', label: 'How to take £4m out of opex' },
    { id: 'goal_opex', kind: 'goal', label: 'Achieve £4m annualised opex reduction by Q2 2027' },
    { id: 'opt_offshore', kind: 'option', label: 'Offshore support (TaskUs)' },
    { id: 'opt_automate', kind: 'option', label: 'Automation-led reduction' },
    { id: 'fac_automation', kind: 'factor', label: 'Automation deployment level' },
  ],
  edges: [{ from: 'opt_automate', to: 'goal_opex' }],
};

function makePayload(message: string) {
  return {
    kind: 'message' as const,
    scenario_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    turn_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    stage: 'frame' as const,
    message,
    turn_class: 'frame' as const,
    source: 'composer' as const,
  };
}

function makeResult(): DraftGraphResult {
  return {
    blocks: [],
    assistantText: 'Drafted a decision graph.',
    latencyMs: 1000,
    strengthenItems: [],
    coachingSummary: null,
    coachingWideningLog: null,
    // The LLM-authored enum that selects the advisory. `thin` is what staging
    // returned for B2 — the whole point of the row is that nothing derives it.
    coachingWideningLogObject: { brief_completeness: 'thin' },
    coachingBiasSignals: null,
    draftWarnings: [],
    graphOutput: GRAPH,
  } as unknown as DraftGraphResult;
}

describe('LINK-R1 C1 — the brief-completeness advisory on the clarify-v2 (briefOverride) path', () => {
  // THE MEASURED CASE. L3 §2/§5 records the intake gate offering the chips
  // `Use sensible defaults · Goal: grow revenue · Goal: cut costs`, and §5 C2
  // records the drafter proceeding "given no new information beyond 'use
  // sensible defaults'". This is the turn on which the false sentence shipped.
  it('withholds "light on detail" when the real brief travels as briefOverride and payload.message is the intake chip', () => {
    const res = draftResultToOlumiResponse(
      makeResult(),
      makePayload('Use sensible defaults'),
      true,
      'req-override-1',
      // The brief the pipeline actually drafted from — `effectiveBrief`.
      BRIEF_TEXT_AS_PERSISTED.B2,
    );

    expect(
      res.assistant_text,
      'B2 was still told its brief was light on detail on the path the product walks',
    ).not.toContain(THIN_SENTENCE);
  });

  // Passes at pristine BY ACCIDENT (see the header): this answer carries
  // "Q3 2027" / "one", so the pre-fix guard fired on the ANSWER. Kept so that
  // accident cannot quietly become the mechanism.
  it('withholds it for a longer intake answer too — for the brief, not because the answer happens to carry a digit', () => {
    const res = draftResultToOlumiResponse(
      makeResult(),
      makePayload(B2_INTAKE_ANSWER),
      true,
      'req-override-2',
      BRIEF_TEXT_AS_PERSISTED.B2,
    );

    expect(res.assistant_text).not.toContain(THIN_SENTENCE);
  });

  it('KEEPS it when the effective brief genuinely states nothing quantitative — the discriminating positive', () => {
    // Without this the fix could pass by suppressing the advisory
    // unconditionally, which is a different behaviour and deletes a
    // legitimate nudge (CLAUDE.md trap 13b: a guard must not agree with
    // itself).
    const res = draftResultToOlumiResponse(
      makeResult(),
      makePayload('Use sensible defaults'),
      true,
      'req-override-3',
      'Should we go into Germany or push harder in the UK? Not sure.',
    );

    expect(res.assistant_text).toContain(THIN_SENTENCE);
  });

  it('still reads payload.message on the ordinary draft turn, where no override exists', () => {
    // The ordinary path passes `effectiveBrief === payload.message`. Behaviour
    // there is unchanged — pinned so a later edit cannot quietly stop
    // consulting the brief on the path 2.972 already covers.
    const res = draftResultToOlumiResponse(
      makeResult(),
      makePayload(BRIEF_TEXT_AS_PERSISTED.B2),
      true,
      'req-ordinary',
      BRIEF_TEXT_AS_PERSISTED.B2,
    );

    expect(res.assistant_text).not.toContain(THIN_SENTENCE);
  });
});

/**
 * THE HALF THE UNIT TESTS ABOVE CANNOT REACH.
 *
 * Every case above calls `draftResultToOlumiResponse` directly and hands it
 * the brief itself, so it pins the COMPOSER. It says nothing about whether the
 * CALLERS pass the right string — and that wiring is exactly where the defect
 * lived. TypeScript forces a 5th argument now, but `payload.message` would
 * satisfy the type and reinstate the bug in silence.
 *
 * ── ROUND 2: THE FIRST VERSION OF THIS GUARD WAS WRONG IN TWO WAYS ─────────
 * The adversarial review (#918, `c1fabe15`) measured both, and the second one
 * let a real defect through, so both are recorded rather than quietly fixed:
 *
 *  (N1) Its comment said it "counts the call sites rather than checking a
 *       known number". It executed `expect(calls.length).toBe(2)` — a
 *       REMEMBERED number — and read exactly ONE FILE. A fourth call site in
 *       `scripts/capture-goal-constraints-wire.ts:89` was therefore invisible
 *       to it, still passing 4 arguments, `error TS2554` and compiled by
 *       nothing (`tsc -p tsconfig.build.json --listFiles` and `tsc -p
 *       tsconfig.json --listFiles` BOTH returned 0 hits for scripts/ —
 *       measured at c1fabe15, not assumed). A claim about our own
 *       verification is still a claim (CLAUDE.md trap 12/20).
 *  (N2) It was LINE-SHAPED: reformatting the CORRECT `:773` call across
 *       multiple lines — which is prettier's own output for a 124-char line
 *       against `printWidth: 80` — turned it RED with the semantics untouched.
 *       A guard that REDs on formatting is a broken alarm in waiting (trap 7).
 *
 * ── WHAT IT DOES NOW ───────────────────────────────────────────────────────
 * It parses with the TypeScript compiler, not with `String.split('\n')`, so it
 * is immune to formatting, to comments that mention the symbol, and to
 * whitespace. Nothing here is mirrored:
 *
 *  · The REQUIRED ARITY is DERIVED FROM THE DECLARATION at your tip (its
 *    parameters minus the optional/defaulted/rest ones). Add a sixth required
 *    parameter and every call site in the repo must pass six — no number in
 *    this file to update, which is the whole point: a future required-param
 *    change cannot silently strand a caller.
 *  · The BRIEF PARAMETER'S NAME AND INDEX are derived from the same
 *    declaration, so the "not the wire message" assertion binds to the
 *    parameter by identity rather than to a position someone remembered.
 *  · The FILE SET is derived by walking the repo, so `scripts/`, `tools/`,
 *    `tests/` and `sdk/` are all in scope. The blocker above is exactly what
 *    a one-file sweep cannot see.
 *
 * Non-vacuity is proven in-test, not assumed (trap 13): the walk must find
 * files, the symbol must appear in more than one file, call sites must be
 * non-zero, and a CONTRAST CONTROL runs the identical extractor over a
 * different symbol from the same module and requires it to find call sites
 * too — so a silently-blind parser cannot pass by finding nothing anywhere.
 */
describe('LINK-R1 C1 — every caller passes the drafted-from brief, not the wire message', () => {
  const NAME = 'draftResultToOlumiResponse';
  /** A symbol from the same dispatch seam, used only as a contrast control. */
  const CONTRAST_NAME = 'finaliseV5Response';

  const DISPATCHER = fileURLToPath(new URL('../draft-graph-dispatch.ts', import.meta.url));

  /** Walk up from this spec until the directory that holds package.json + tsconfig.json. */
  const REPO_ROOT = (() => {
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 12; i += 1) {
      if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'tsconfig.json'))) return dir;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    throw new Error('could not locate the repo root from this spec');
  })();

  const SKIP_DIRS = new Set([
    'node_modules',
    'dist',
    '.git',
    'coverage',
    'playwright-report',
    'test-results',
    '.turbo',
  ]);

  function walkTypeScriptFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walkTypeScriptFiles(join(dir, entry.name), out);
      } else if (/\.(?:m|c)?tsx?$/.test(entry.name)) {
        out.push(join(dir, entry.name));
      }
    }
    return out;
  }

  interface CallSite {
    readonly file: string;
    readonly line: number;
    readonly argCount: number;
    /** Source text of the argument occupying the brief parameter's position, if any. */
    readonly briefArgText: string | null;
  }

  /** Every `NAME(...)` CallExpression in `source`, via the TypeScript parser. */
  function findCallSites(file: string, source: string, name: string, briefIndex: number): CallSite[] {
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true);
    const found: CallSite[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) {
        const briefArg = node.arguments[briefIndex];
        found.push({
          file,
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          argCount: node.arguments.length,
          briefArgText: briefArg ? briefArg.getText(sf).replace(/\s+/g, ' ').trim() : null,
        });
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(sf, visit);
    return found;
  }

  /** The declaration, read at YOUR tip — the source of every number below. */
  const declaration = (() => {
    const source = readFileSync(DISPATCHER, 'utf8');
    const sf = ts.createSourceFile(DISPATCHER, source, ts.ScriptTarget.ES2022, true);
    let decl: ts.FunctionDeclaration | undefined;
    ts.forEachChild(sf, (node) => {
      if (ts.isFunctionDeclaration(node) && node.name?.text === NAME) decl = node;
    });
    if (!decl) throw new Error(`could not find the ${NAME} declaration in ${DISPATCHER}`);
    const params = decl.parameters.map((p) => ({
      name: ts.isIdentifier(p.name) ? p.name.text : '(destructured)',
      required: !p.questionToken && !p.initializer && !p.dotDotDotToken,
    }));
    return { params, requiredCount: params.filter((p) => p.required).length };
  })();

  /** The parameter that carries the brief — found BY NAME in the declaration. */
  const BRIEF_PARAM_INDEX = declaration.params.findIndex((p) => p.name === 'effectiveBrief');

  const allFiles = walkTypeScriptFiles(REPO_ROOT);
  const sources = new Map<string, string>();
  for (const f of allFiles) {
    const text = readFileSync(f, 'utf8');
    if (text.includes(NAME) || text.includes(CONTRAST_NAME)) sources.set(f, text);
  }

  const callSites = [...sources].flatMap(([f, text]) => findCallSites(f, text, NAME, BRIEF_PARAM_INDEX));
  const contrastSites = [...sources].flatMap(([f, text]) => findCallSites(f, text, CONTRAST_NAME, 0));

  const isTestFile = (f: string): boolean => /(?:__tests__|\.test\.tsx?$|\.spec\.tsx?$)/.test(f);
  const rel = (f: string): string => f.slice(REPO_ROOT.length + 1);

  it('the probe is not blind — the walk, the symbol and the extractor all find something', () => {
    // Trap 13: an absence/compliance claim needs a demonstrated presence.
    expect(allFiles.length, 'the repo walk found no TypeScript files at all').toBeGreaterThan(0);
    expect(
      new Set(callSites.map((c) => c.file)).size,
      `${NAME} was found in fewer than two files — a one-file sweep is exactly the blindness that let scripts/capture-goal-constraints-wire.ts through`,
    ).toBeGreaterThan(1);
    expect(callSites.length, `found no ${NAME} call sites — the parser is blind`).toBeGreaterThan(0);
    // CONTRAST CONTROL: the identical extractor over a different symbol. If the
    // parse silently produced nothing, this fails too, so "0 violations" can
    // never be manufactured by a broken instrument.
    expect(
      contrastSites.length,
      `contrast control: the same extractor found no ${CONTRAST_NAME} call sites, so it is not discriminating`,
    ).toBeGreaterThan(0);
    expect(BRIEF_PARAM_INDEX, `no parameter named effectiveBrief on ${NAME}`).toBeGreaterThanOrEqual(0);
  });

  it('every call site in the repo passes the arity the declaration REQUIRES (derived, not remembered)', () => {
    const short = callSites.filter((c) => c.argCount < declaration.requiredCount);
    expect(
      short.map((c) => `${rel(c.file)}:${c.line} passes ${c.argCount} of ${declaration.requiredCount}`),
      `${NAME} requires ${declaration.requiredCount} arguments (${declaration.params
        .filter((p) => p.required)
        .map((p) => p.name)
        .join(', ')}) — these call sites do not pass them`,
    ).toEqual([]);
  });

  it('no production call site passes the wire message as the brief', () => {
    // Test call sites legitimately pass `PAYLOAD.message`: on the ordinary
    // draft turn the wire message IS the brief, and those specs exercise
    // exactly that path. The property being pinned is about the PRODUCT.
    const offenders = callSites
      .filter((c) => !isTestFile(c.file))
      .filter((c) => c.briefArgText !== null && /\bpayload\.message\b/i.test(c.briefArgText));
    expect(
      offenders.map((c) => `${rel(c.file)}:${c.line} -> ${c.briefArgText}`),
      'a production call site reinstates the defect: it hands the composer the wire message instead of the brief the pipeline drafted from',
    ).toEqual([]);
  });

  it('the dispatcher itself passes its own effectiveBrief, by identity', () => {
    const inDispatcher = callSites.filter((c) => c.file === DISPATCHER);
    expect(inDispatcher.length, 'no call sites found in the dispatcher').toBeGreaterThan(0);
    const wrong = inDispatcher.filter((c) => c.briefArgText !== 'effectiveBrief');
    expect(
      wrong.map((c) => `${rel(c.file)}:${c.line} -> ${c.briefArgText}`),
      'the dispatcher must hand the composer the same value it drafted from — the variable, by name',
    ).toEqual([]);
  });
});
