/** S3: ordinary Required test; neither a workflow nor an allowlist drives discovery. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  assertReplyAppenderBaseline, ROUTE_FILE, scanReplyAppenders,
  type Appender, type BaselineRow,
} from '../../../../scripts/ci/reply-appender-census.js';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const ROUTE = readFileSync(join(ROOT, ROUTE_FILE), 'utf8');
const BASELINE = JSON.parse(readFileSync(join(ROOT, 'scripts/ci/reply-appender-baseline.json'), 'utf8')) as BaselineRow[];
const CENSUS = scanReplyAppenders(ROOT, ROUTE);
const sourceOf = (source: string): ts.SourceFile => ts.createSourceFile(ROUTE_FILE, source, ts.ScriptTarget.Latest, true);
const callsNamed = (source: string, name: string): ts.CallExpression[] => {
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) calls.push(node);
    node.forEachChild(visit);
  };
  visit(sourceOf(source));
  return calls;
};
const injectLive = (line: string): string => {
  const calls = callsNamed(ROUTE, 'composeReplyShape');
  expect(calls).toHaveLength(2);
  let statement: ts.Node = calls.at(-1)!;
  while (!ts.isVariableStatement(statement)) {
    if (!statement.parent) throw new Error('mutant probe could not find live composer statement');
    statement = statement.parent;
  }
  const at = statement.getStart(statement.getSourceFile());
  return `${ROUTE.slice(0, at)}${line}\n${ROUTE.slice(at)}`;
};
const removeCalls = (source: string, name: string): string => {
  const calls = callsNamed(source, name);
  expect(calls.length, 'the removal mutant must actually remove a source call').toBeGreaterThan(0);
  for (const call of calls.sort((a, b) => b.pos - a.pos)) {
    const first = call.arguments[0];
    if (!first) throw new Error('removal mutant has no identity replacement');
    source = `${source.slice(0, call.getStart(call.getSourceFile()))}${first.getText(call.getSourceFile())}${source.slice(call.end)}`;
  }
  return source;
};
const identities = (rows: Appender[]): string[] => rows.map(row => `${row.path}:${row.key}`);

describe('reply appender census is a Required CI ratchet', () => {
  it('matches the committed baseline in both directions, with a migration reason per owner', () => {
    expect(() => assertReplyAppenderBaseline(CENSUS, BASELINE)).not.toThrow();
  });

  it('POSITIVE CONTROL: finds at least N baseline owners, including A7 and the cell horizon on both paths', () => {
    expect(BASELINE.length, 'N cannot be an empty baseline').toBeGreaterThan(0);
    expect(CENSUS.length, `discovered owners >= N=${BASELINE.length}`).toBeGreaterThanOrEqual(BASELINE.length);
    for (const path of ['live', 'replay']) for (const name of ['withA7AfterGate', 'withCellHorizon']) {
      expect(CENSUS.some(row => row.path === path && row.name === name), `${path}: ${name}`).toBe(true);
    }
    expect(() => assertReplyAppenderBaseline([], [])).toThrow('zero is a broken probe');
  });

  it.each([
    ['assignment', 'reply = withNewThing(reply);', 'withNewThing'],
    ['+= assignment', 'reply += withNewThing(reply);', 'withNewThing'],
    ['carrier assignment', 'wireBody.assistant_text = withNewThing(wireBody.assistant_text); reply = wireBody.assistant_text;', 'withNewThing'],
    ['member callee', 'reply = newOwner.withDisclosures(reply);', 'newOwner.withDisclosures'],
    ['string-element callee', "reply = newOwner['withDisclosures'](reply);", 'newOwner["withDisclosures"]'],
  ])('MUTANT RED: a new owner via %s is discovered from an in-memory route', (_kind, line, name) => {
    const mutant = scanReplyAppenders(ROOT, injectLive(line));
    expect(mutant.some(row => row.path === 'live' && row.name === name), 'probe sees the injected call itself').toBe(true);
    expect(() => assertReplyAppenderBaseline(mutant, BASELINE)).toThrow(
      'move it into a typed composer input, or add it to the baseline with reviewer sign-off',
    );
  }, 30_000);

  it('MUTANT RED: removing a baseline appender requires deleting its stale rows', () => {
    const mutant = scanReplyAppenders(ROOT, removeCalls(ROUTE, 'withA7AfterGate'));
    expect(mutant.some(row => row.name === 'withA7AfterGate')).toBe(false);
    expect(() => assertReplyAppenderBaseline(mutant, BASELINE)).toThrow('Stale reply appender');
    expect(() => assertReplyAppenderBaseline(mutant, BASELINE)).toThrow('ratchet down; delete it from the baseline');
  }, 30_000);

  it('CONTROL: line numbers, whitespace and comments do not change baseline keys', () => {
    const formatted = scanReplyAppenders(ROOT, `// line-number shift\n\n${ROUTE.split('\n').join('\n\n')}`);
    expect(identities(formatted)).toEqual(identities(CENSUS));
    expect(() => assertReplyAppenderBaseline(formatted, BASELINE)).not.toThrow();
  }, 30_000);

  it('CONTROL: unrelated, shadowed, obligation-only and post-composer calls do not become reply owners', () => {
    const before = injectLive([
      'const unrelated = withUnrelatedThing("metadata");',
      '{ let reply = "shadowed"; reply = withShadowedThing(reply); }',
      'wireBody = { ...wireBody, blocks: withBlocksOnly(wireBody.blocks) };',
      'obligations.push(withObligationOnly(obligations));',
    ].join('\n'));
    const composers = callsNamed(before, 'composeReplyShape');
    const at = composers.at(-1)!.end;
    const mutant = `${before.slice(0, at)}; reply = withAfterComposer(reply)${before.slice(at)}`;
    const rows = scanReplyAppenders(ROOT, mutant);
    for (const name of ['withUnrelatedThing', 'withShadowedThing', 'withBlocksOnly', 'withObligationOnly', 'withAfterComposer']) {
      expect(rows.some(row => row.name === name), name).toBe(false);
    }
    expect(identities(rows)).toEqual(identities(CENSUS));
  }, 30_000);

  it('cross-checks every TEXT_WRITERS entry from the existing last-writer guard using its AST', () => {
    const guard = readFileSync(join(ROOT, 'src/orchestrator-v5/agent-lane/__tests__/reply-composer-last-writer.test.ts'), 'utf8');
    let names: string[] | undefined;
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'TEXT_WRITERS'
        && node.initializer && ts.isArrayLiteralExpression(node.initializer)) {
        names = node.initializer.elements.map(element => {
          if (!ts.isStringLiteral(element) || !element.text.endsWith('(')) throw new Error('TEXT_WRITERS is no longer a literal call-name array');
          return element.text.slice(0, -1);
        });
      }
      node.forEachChild(visit);
    };
    visit(sourceOf(guard));
    expect(names?.length, 'cross-check probe sees the existing writer list').toBeGreaterThan(0);
    for (const name of names!) expect(CENSUS.some(row => row.path === 'live' && row.name === name), name).toBe(true);
  });
});
