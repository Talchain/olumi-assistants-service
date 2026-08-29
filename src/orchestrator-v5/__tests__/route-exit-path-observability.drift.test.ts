/**
 * FAIL-LOUD drift guard: every 200-OK exit must be able to say WHICH PATH
 * SERVED IT, from one place, without a feature flag.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT WAS ALREADY TRUE WHEN THIS GUARD WAS WRITTEN (derived, not assumed).
 *
 * The premise this lane was dispatched on — "the cascade exits return before
 * `runTurnExecutor`, so you cannot answer 'why was this turn handled that way'
 * from one place for the majority of turns" — is TRUE about the EXECUTOR and
 * FALSE about OBSERVABILITY, and the distinction is the whole point of this
 * file:
 *
 *   - `sendFinalised200` takes `exitPath: V5ExitPath` as a REQUIRED third
 *     positional parameter. Every 200-OK exit is forced by tsc to name its
 *     dispatch family. There is no exit that omits one.
 *   - That value reaches `logFinalisedResponse`, which emits
 *     `event: 'v5.response.finalised'` with `exit_path` through `log.info`
 *     — UNGATED. It is not behind `CEE_DIAGNOSTIC_TRACE_ENABLED`.
 *   - It sits immediately before the file's SOLE `reply.code(200).send`,
 *     at the same brace depth. Every 200-OK turn passes through it.
 *
 * So the server-side record already exists and is complete. What is
 * flag-gated is the WIRE copy — `_diagnostic_trace.exit_path` — which is what
 * `scripts/ci/staging-journey-smoke.mjs` reads, and which is why that check
 * reports `exit_path=null` on deployed staging. THAT IS A FLAG POSTURE, NOT A
 * MISSING RECORD, and this guard does not change it.
 *
 * WHAT WAS UNPINNED, AND IS WHY THIS FILE EXISTS.
 *
 * Nothing asserted any of the three properties above. Each can be lost
 * silently, and each loss is invisible to every other test in the estate:
 *
 *   (a) Wrapping the log in `if (config.features.diagnosticTraceEnabled)`
 *       would make every 200-OK turn's exit path vanish from the ungated
 *       stream. tsc is happy. No suite goes red.
 *   (b) Adding a second `reply.code(200).send` would create an exit that
 *       bypasses the record entirely.
 *   (c) Passing a COMPUTED family (`sendFinalised200(reply, id, pickFamily(x),
 *       …)`) typechecks perfectly — and silently blinds every
 *       source-scanning guard in this family at once, including
 *       `route-egress-analysis-state-freshness.drift.test.ts` and
 *       `route-egress-claim-safety-marking.drift.test.ts`, which classify
 *       exits by reading route-v2.ts as text. One computed argument and they
 *       all stop discriminating while staying green.
 *
 * DERIVE-NOT-MIRROR (trap 12). This test hand-lists NO exit path and writes
 * NO count. The sanctioned vocabulary is parsed from the
 * `V5DiagnosticExitPath` union in v5-diagnostic-trace.ts — the same single
 * source `V5ExitPath` is derived from — and the population is enumerated from
 * route-v2.ts with the same balanced-paren scan its sibling guards use.
 * A new dispatch family appears here immediately.
 *
 * ⚠ COMMENTS ARE STRIPPED BEFORE ANY DELIMITING. Writing this guard, a parser
 * that found the union's terminating `;` in the RAW source stopped inside a
 * doc comment ("…as process_meta_intake; …") and silently returned 7 of 13
 * members. A second bug in the same probe — a `[a-z_]` character class that
 * excluded DIGITS — dropped `clarify_v2` from the union AND misreported its
 * call site as a non-literal. Both produced confident, wrong, plausible
 * numbers. Hence the floors and the controls below.
 *
 * THE DELIBERATE DIVERGENCE, NAMED (not silently filled in).
 * The NON-200 exits (BoundaryError envelopes: 4xx/5xx) deliberately record no
 * `exit_path`. They are identified by `validator` + `reason` on the envelope
 * they already return (e.g. `turn_commit` / `system_event_commit_failed`),
 * and stamping an exit path onto them would change what those turns return to
 * a user — a behavioural change, out of scope for instrumentation. This guard
 * asserts that population EXISTS so the divergence stays observed rather than
 * assumed, and does NOT require an exit path of it.
 *
 * WHY NOT CONVERGE ON THE ROUTING LOG. `orchestrator-v5/routing/routing-log.ts`
 * has exactly ONE non-test writer (`turn-executor.ts`), and its row is a
 * record of an LLM ROUTING DECISION: `intent_class`, `handler_id`,
 * `coaching_mode`, `sonnet_text`. The cascade exits make zero LLM calls, so
 * joining them to it would mean fabricating those fields for turns that never
 * had them. Two observability authorities for one question is the defect this
 * lane was sent to fix; `v5.response.finalised` is the one that already covers
 * the whole 200-OK population, so it is the carrier this guard pins.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTE_V2 = resolve(HERE, '../../orchestrator/route-v2.ts');
const TRACE_TYPES = resolve(HERE, '../diagnostics/v5-diagnostic-trace.ts');

/** The diagnostics-only member: tags the 500 BoundaryError trace, never a 200. */
const DIAGNOSTICS_ONLY = 'draft_graph_error';

/**
 * Strip line and block comments. MUST run before any delimiter search: prose
 * in this estate's doc comments contains both `;` and `'`, and a raw scan
 * silently truncates. See the header note.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** Parse the sanctioned exit-path vocabulary from the union declaration. */
function deriveExitPathUnion(traceSource: string): string[] {
  const clean = stripComments(traceSource);
  const start = clean.indexOf('export type V5DiagnosticExitPath');
  if (start < 0) throw new Error('V5DiagnosticExitPath declaration not found');
  const end = clean.indexOf(';', start);
  if (end < 0) throw new Error('V5DiagnosticExitPath declaration is unterminated');
  // [a-z0-9_] — the digit class is load-bearing (`clarify_v2`).
  return [...clean.slice(start, end).matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]!);
}

interface SendCall {
  readonly offset: number;
  /** The third positional argument exactly as written in source. */
  readonly exitPathArg: string;
  /** True when that argument is a bare quoted string literal. */
  readonly isLiteral: boolean;
  /** The literal's value, or null when it is not a literal. */
  readonly literalValue: string | null;
}

/**
 * Balanced-paren scan over `sendFinalised200(` calls, then a depth-aware
 * split of the argument list to isolate argument 3.
 *
 * Same technique as the sibling egress guards, deliberately: two guards
 * reading one population with two different scanners is how they come to
 * disagree about which exits exist.
 */
function enumerateSendCalls(source: string): SendCall[] {
  const calls: SendCall[] = [];
  for (const m of source.matchAll(/sendFinalised200\(/g)) {
    const matchStart = m.index!;
    if (/function\s+$/.test(source.slice(Math.max(0, matchStart - 20), matchStart))) continue;

    const openParen = matchStart + m[0].length - 1;
    let depth = 0;
    let j = openParen;
    for (; j < source.length; j++) {
      const c = source[j];
      if (c === '(') depth++;
      else if (c === ')') {
        depth--;
        if (depth === 0) break;
      }
    }

    const inner = source.slice(openParen + 1, j);
    const args: string[] = [];
    let d = 0;
    let cur = '';
    for (const ch of inner) {
      if (ch === '(' || ch === '[' || ch === '{') d++;
      else if (ch === ')' || ch === ']' || ch === '}') d--;
      if (ch === ',' && d === 0) {
        args.push(cur);
        cur = '';
      } else cur += ch;
    }
    args.push(cur);

    const third = (args[2] ?? '<MISSING>').trim();
    const literal = /^'([a-z0-9_]+)'$/.exec(third);
    calls.push({
      offset: matchStart,
      exitPathArg: third,
      isLiteral: literal !== null,
      literalValue: literal?.[1] ?? null,
    });
  }
  return calls;
}

describe('route exit-path observability — every 200-OK turn names its dispatch family', () => {
  const routeSource = readFileSync(ROUTE_V2, 'utf8');
  const routeCode = stripComments(routeSource);
  const union = deriveExitPathUnion(readFileSync(TRACE_TYPES, 'utf8'));
  const sanctioned = new Set(union.filter((p) => p !== DIAGNOSTICS_ONLY));
  const calls = enumerateSendCalls(routeSource);

  it('the enumerator SEES the route exits (or every assertion below is vacuous)', () => {
    // Trap 13. A floor, never a count — the population grows, and a count here
    // would be the mirror this guard exists to prevent.
    expect(calls.length).toBeGreaterThanOrEqual(15);
  });

  it('the derived vocabulary is non-trivial (the union parser is not silently truncating)', () => {
    // The exact failure that happened while writing this file returned 7 of 13.
    // A floor well above the historical truncation, still not a count.
    expect(sanctioned.size).toBeGreaterThanOrEqual(10);
    expect(union).toContain(DIAGNOSTICS_ONLY);
    // Digit-bearing member: pins the character class that dropped it once.
    expect(union).toContain('clarify_v2');
  });

  it('every 200-OK exit names its family as a SOURCE-READABLE LITERAL', () => {
    const computed = calls.filter((c) => !c.isLiteral);
    expect(
      computed.map((c) => `sendFinalised200@${c.offset} → ${c.exitPathArg}`),
      'route-v2 has a sendFinalised200 call whose exit path is COMPUTED rather than written ' +
        'as a literal. This typechecks and changes no behaviour, which is exactly why it is ' +
        'dangerous: every source-scanning guard over this population — this file, ' +
        'route-egress-analysis-state-freshness.drift.test.ts, ' +
        'route-egress-claim-safety-marking.drift.test.ts — classifies exits by reading the ' +
        'literal at the call site. A computed argument blinds all of them AT ONCE while they ' +
        'stay green. Write the family literally at the call site.',
    ).toEqual([]);
  });

  it('every named family is a SANCTIONED member of the derived union', () => {
    const strays = calls
      .filter((c) => c.literalValue !== null && !sanctioned.has(c.literalValue))
      .map((c) => `sendFinalised200@${c.offset} → '${c.literalValue}'`);
    expect(
      strays,
      'a sendFinalised200 call names an exit path that is not a sanctioned 200-OK member of ' +
        'V5DiagnosticExitPath. Add the family to that union (the single source V5ExitPath is ' +
        'derived from) rather than inventing a string here.',
    ).toEqual([]);
  });

  it(`no 200-OK exit claims '${DIAGNOSTICS_ONLY}' (it tags the 500 trace path)`, () => {
    expect(calls.filter((c) => c.literalValue === DIAGNOSTICS_ONLY)).toEqual([]);
  });

  it('the file has exactly ONE reply.code(200).send — no exit bypasses the record', () => {
    const sends = [...routeCode.matchAll(/reply\.code\(200\)\.send\(/g)];
    expect(
      sends.length,
      'route-v2 must have exactly one 200-OK send, inside sendFinalised200. A second one is an ' +
        'exit that never passes through logFinalisedResponse, so its turn can no longer say ' +
        'which path served it. See scripts/check-no-direct-analysis-ready.sh.',
    ).toBe(1);
  });

  it('the exit-path record is UNCONDITIONAL — not behind a flag, not inside a branch', () => {
    const logCalls = [...routeCode.matchAll(/logFinalisedResponse\(/g)]
      .map((m) => m.index!)
      .filter((o) => !/function\s+$/.test(routeCode.slice(Math.max(0, o - 20), o)));
    expect(logCalls).toHaveLength(1);

    const sendAt = routeCode.indexOf('reply.code(200).send(');
    const logAt = logCalls[0]!;
    expect(logAt, 'the exit-path log must precede the send').toBeLessThan(sendAt);

    const between = routeCode.slice(logAt, sendAt);
    // A brace between them means the log sits inside a block the send is outside
    // of — i.e. it became conditional. A control-flow keyword means the same.
    expect(
      { braces: (between.match(/[{}]/g) ?? []).length, span: between.trim().slice(0, 160) },
      'logFinalisedResponse — the ONLY ungated record of which path served a 200-OK turn — is ' +
        'no longer unconditionally on the path to the send. If it has been wrapped in a ' +
        'feature-flag branch (e.g. diagnosticTraceEnabled), every turn silently loses its ' +
        'exit_path from the v5.response.finalised stream while tsc and every other suite stay ' +
        'green. The wire copy in _diagnostic_trace IS flag-gated; this server-side one must ' +
        'not be.',
    ).toMatchObject({ braces: 0 });
    expect(/\b(if|else|catch|switch|for|while)\b/.test(between)).toBe(false);
  });

  it('the record carries the exit path itself, not just the request id', () => {
    const call = /logFinalisedResponse\(([^)]*)\)/.exec(routeCode);
    expect(call).not.toBeNull();
    expect(
      call![1]!.split(',').map((s) => s.trim()),
      'logFinalisedResponse must be passed exitPath — without it the event is emitted but the ' +
        'family is unrecorded, which reads as healthy and answers nothing.',
    ).toContain('exitPath');
  });

  it('NAMED DIVERGENCE — non-200 exits deliberately record no exit path', () => {
    // Not a gap to fill. These return BoundaryError envelopes identified by
    // `validator` + `reason`; stamping an exit path onto them would change what
    // the turn returns to a user (behavioural, out of scope for instrumentation).
    // Asserted so the divergence stays OBSERVED — if this population ever empties,
    // the reasoning above needs revisiting rather than silently holding.
    const nonOk = [...routeCode.matchAll(/reply\.code\((?!200\))[^)]*\)\.send\(/g)];
    expect(nonOk.length).toBeGreaterThanOrEqual(5);
  });

  // ── POSITIVE CONTROLS — no detector above may be vacuously green ──────────

  it('CONTROL — the literal detector FLAGS a computed exit path', () => {
    const found = enumerateSendCalls(
      `sendFinalised200(reply, requestId, pickFamily(ingress), response, { graph: null });`,
    );
    expect(found).toHaveLength(1);
    expect(found[0]!.isLiteral).toBe(false);
    expect(found[0]!.literalValue).toBeNull();
  });

  it('CONTROL — and ACCEPTS a written literal, including a digit-bearing one', () => {
    const found = enumerateSendCalls(
      `sendFinalised200(reply, requestId, 'clarify_v2', response, { graph: null });`,
    );
    expect(found).toHaveLength(1);
    expect(found[0]!.isLiteral).toBe(true);
    expect(found[0]!.literalValue).toBe('clarify_v2');
  });

  it('CONTROL — the stray detector FLAGS a family absent from the union', () => {
    const found = enumerateSendCalls(
      `sendFinalised200(reply, requestId, 'invented_family', response, { graph: null });`,
    );
    expect(found).toHaveLength(1);
    expect(sanctioned.has(found[0]!.literalValue!)).toBe(false);
  });

  it('CONTROL — an argument list with nested calls still isolates argument 3', () => {
    // The depth-aware split is what makes the literal check trustworthy; a naive
    // comma split would tear this apart and misreport the family.
    const found = enumerateSendCalls(
      `sendFinalised200(reply, requestId, 'edit_graph', buildResponse(a, b), { graph: g(x, y) });`,
    );
    expect(found).toHaveLength(1);
    expect(found[0]!.literalValue).toBe('edit_graph');
  });

  it('CONTROL — the comment stripper prevents the truncation that produced 7 of 13', () => {
    const fixture = `
      export type V5DiagnosticExitPath =
        | 'alpha'
        // prose with a semicolon; and an apostrophe's quote
        | 'beta_2';
    `;
    expect(deriveExitPathUnion(fixture)).toEqual(['alpha', 'beta_2']);
  });

  it('CONTROL — the unconditional-record detector SEES a flag-wrapped log', () => {
    const wrapped = `
      if (config.features.diagnosticTraceEnabled) {
        logFinalisedResponse(requestId, exitPath, wireBody, egress.ok, false);
      }
      return reply.code(200).send(wireBody);
    `;
    const logAt = wrapped.indexOf('logFinalisedResponse(');
    const sendAt = wrapped.indexOf('reply.code(200).send(');
    const between = wrapped.slice(logAt, sendAt);
    expect((between.match(/[{}]/g) ?? []).length).toBeGreaterThan(0);
  });
});
