/**
 * Versioned graph writes must carry the revision captured by their original
 * server read. This checks the producer arguments and both forwarding seams,
 * rather than accepting an unrelated occurrence of `expectedRevision`.
 *
 * Scope: production TypeScript at this checkout. Runtime validation of the
 * revision and the RPC CAS/replay contract live in the store's v6 tests.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { __setUseAppendV6ForTest } from '../session/supabase-store.js';

beforeEach(() => {
  __setUseAppendV6ForTest(true);
});
afterEach(() => {
  __setUseAppendV6ForTest(false);
});

const SRC_ROOT = fileURLToPath(new URL('../../', import.meta.url));

function productionFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === '__tests__' || name === 'generated' ? [] : productionFiles(path);
    }
    return name.endsWith('.ts') && !name.endsWith('.d.ts') && !name.endsWith('.test.ts') ? [path] : [];
  });
}

import { parse, unwrap, propertyValues, guaranteesRevision, revisionDoors } from './graph-writer-revision-guard-utils.js';

const CORPUS = productionFiles(SRC_ROOT).map((path) =>
  parse(relative(SRC_ROOT, path), readFileSync(path, 'utf8')));
const DOORS = CORPUS.flatMap(revisionDoors);

function versionedRpcCalls(file: ts.SourceFile): Array<{ path: string; rpc: string; hasRevision: boolean }> {
  const calls: Array<{ path: string; rpc: string; hasRevision: boolean }> = [];
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'rpc') {
      const rpc = node.arguments[0];
      if (rpc && (ts.isStringLiteral(rpc) || ts.isNoSubstitutionTemplateLiteral(rpc))
        && (rpc.text === 'append_turn_atomic_v5' || rpc.text === 'append_turn_atomic_v6')) {
        calls.push({ path: file.fileName, rpc: rpc.text,
          hasRevision: node.arguments[1] !== undefined && guaranteesRevision(node.arguments[1], false, 'p_expected_revision') });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return calls;
}

describe('versioned graph writer revision propagation', () => {
  it('collects the real producer population, including the forwarding and registration doors', () => {
    expect(DOORS.length).toBeGreaterThan(15);
    expect(new Set(DOORS.map((door) => door.path))).toEqual(new Set([
      'orchestrator-v5/apply-operations.ts',
      'orchestrator-v5/commit.ts',
      'orchestrator-v5/handlers/draft-graph-dispatch.ts',
      'orchestrator-v5/handlers/edit-graph-dispatch.ts',
      'orchestrator-v5/turn-executor.ts',
      'orchestrator-v5/system-events/dispatch.ts',
      'orchestrator-v5/system-events/olumi-option-adoption.ts',
      'orchestrator-v5/system-events/option-intervention-edit.ts',
      'routes/assist.v1.scenario-graph-register.ts',
    ]));
  });

  it('every producer that can reach the versioned append supplies expectedRevision', () => {
    expect(DOORS.filter((door) => !door.hasRevision)
      .map((door) => `${door.path}:${door.line} ${door.target}`)).toEqual([]);
  });

  it('PLANTED MUTANT: a missing revision on a versioned call is flagged; the supplied revision passes', () => {
    const missing = "commitDirectAnswer(response, { graph: after });";
    const supplied = "commitDirectAnswer(response, { graph: after, expectedRevision: state.revision });";
    expect(revisionDoors(parse('fixture.ts', missing)).map((door) => door.hasRevision)).toEqual([false]);
    expect(revisionDoors(parse('fixture.ts', supplied)).map((door) => door.hasRevision)).toEqual([true]);
  });

  it('PLANTED MUTANT: graph from read 1 cannot use revision from read 2', () => {
    const fixture = (revision: string) => parse('identity.ts', `
      async function writer() {
        const original = await loadPersistedScenarioStateStrict(id);
        const edited = merge({ mutatedGraph: patch, persistedBase: original.graph });
        const later = await loadPersistedScenarioStateStrict(id);
        commitDirectAnswer(response, { graph: edited, expectedRevision: ${revision}.revision });
      }
    `);
    expect(revisionDoors(fixture('original')).map(door => door.hasRevision)).toEqual([true]);
    expect(revisionDoors(fixture('later')).map(door => door.hasRevision)).toEqual([false]);
  });

  it('does not accept comments, nested fields, undefined or invented/default revisions', () => {
    for (const field of ['/* expectedRevision: state.revision */',
      'other: { expectedRevision: state.revision }', 'expectedRevision: undefined',
      'expectedRevision: null', 'expectedRevision: 0', 'expectedRevision: state.revision ?? 0']) {
      expect(revisionDoors(parse('fixture.ts', `commitDirectAnswer(response, { graph: after, ${field} });`))
        .map((door) => door.hasRevision)).toEqual([false]);
    }
  });

  it('also detects an aliased import and a direct floor version carrier, while excluding non-versioned turns', () => {
    const file = parse('fixture.ts', `
      import { commitDirectAnswer as commit } from './commit.js';
      commit(response, { graph: after });
      appendCheckedGraphWrite({ write: { graph: after, modelVersion: carrier } });
      commitDirectAnswer(response, { contentGraph: before });
      appendCheckedGraphWrite({ write: { agentAnswer: answer }, writesGraph: false });
    `);
    expect(revisionDoors(file).map((door) => door.hasRevision)).toEqual([false, false]);
  });

  it('PLANTED MUTANTS: opaque metadata, opaque spreads and conditional revision-only fields fail closed', () => {
    for (const call of [
      'const write = { graph: after }; commitDirectAnswer(response, write);',
      'commitDirectAnswer(response, { ...write });',
      'commitDirectAnswer(response, { graph: after, ...(condition ? { expectedRevision: state.revision } : {}) });',
      'commitDirectAnswer(response, { graph: after, ...(otherRevision !== undefined ? { expectedRevision: state.revision } : {}) });',
      'commitDirectAnswer(response, { graph: after, ...(state.revision !== undefined ? { expectedRevision: otherRevision } : {}) });',
      'commitDirectAnswer(response, { graph: after, ...(state.revision !== undefined ? { expectedRevision: state.revision } : opaque) });',
      'commitDirectAnswer(response, { graph: after, expectedRevision: state.revision, ...write });',
      'appendCheckedGraphWrite({ write });',
      'appendCheckedGraphWrite(params);',
    ]) {
      expect(revisionDoors(parse('fixture.ts', call)).map((door) => door.hasRevision)).toEqual([false]);
    }
    expect(revisionDoors(parse('fixture.ts',
      'commitDirectAnswer(response, { ...write, expectedRevision: state.revision });'))
      .map((door) => door.hasRevision)).toEqual([true]);
    for (const field of ['expectedRevision', 'state.revision']) {
      expect(revisionDoors(parse('fixture.ts',
        `commitDirectAnswer(response, { graph: after, ...(${field} !== undefined ? { expectedRevision: ${field} } : {}) });`))
        .map((door) => door.hasRevision)).toEqual([true]);
    }
    expect(revisionDoors(parse('fixture.ts',
      'commitDirectAnswer(response, { graph: after, ...(state.revision !== undefined ? { expectedRevision: state.revision } : {}), ...write });'))
      .map((door) => door.hasRevision)).toEqual([false]);
  });

  it('commit forwards the caller revision verbatim into the exact write argument', () => {
    const file = CORPUS.find((entry) => entry.fileName === 'orchestrator-v5/commit.ts')!;
    let forwarded: string[] = [];
    function visit(node: ts.Node): void {
      if (ts.isCallExpression(node) && node.expression.getText(file) === 'appendCheckedGraphWrite') {
        forwarded = propertyValues(node.arguments[0]!, 'write')
          .flatMap((write) => propertyValues(write, 'expectedRevision'))
          .map((value) => value.getText(file));
      }
      ts.forEachChild(node, visit);
    }
    visit(file);
    expect(forwarded).toEqual(['metadata.expectedRevision']);
  });

  it('pins both versioned RPC invocations to the store shim, and v6 carries the supplied revision', () => {
    const calls = CORPUS.flatMap(versionedRpcCalls);
    expect(calls.map(({ path, rpc }) => `${path} ${rpc}`).sort()).toEqual([
      'orchestrator-v5/session/supabase-store.ts append_turn_atomic_v5',
      'orchestrator-v5/session/supabase-store.ts append_turn_atomic_v6',
    ]);
    expect(calls.find((call) => call.rpc === 'append_turn_atomic_v6')?.hasRevision).toBe(true);
    const store = CORPUS.find((file) => file.fileName === 'orchestrator-v5/session/supabase-store.ts')!;
    const forwarded: string[] = [];
    function visit(node: ts.Node): void {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && node.expression.name.text === 'callAppendTurnAtomicV6') forwarded.push(node.arguments[0]!.getText(store));
      ts.forEachChild(node, visit);
    }
    visit(store);
    expect(forwarded).toEqual(['write']);
  });

  it('PLANTED RPC MUTANT: a new direct versioned RPC is visible and its missing revision is flagged', () => {
    const missing = parse('new-door.ts', "client.rpc('append_turn_atomic_v6', { p_graph: after });");
    const supplied = parse('new-door.ts', "client.rpc('append_turn_atomic_v6', { p_graph: after, p_expected_revision: state.revision });");
    expect(versionedRpcCalls(missing)).toEqual([{ path: 'new-door.ts', rpc: 'append_turn_atomic_v6', hasRevision: false }]);
    expect(versionedRpcCalls(supplied)).toEqual([{ path: 'new-door.ts', rpc: 'append_turn_atomic_v6', hasRevision: true }]);
  });

  it('the floor rebinds the original caller expectation after reconciliation and appends that same write', () => {
    const floor = CORPUS.find((file) => file.fileName === 'orchestrator-v5/persist-graph-write.ts')!;
    const forwarded: string[] = [];
    const appendArguments: string[] = [];
    function visit(node: ts.Node): void {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'storedWrite') {
        expect(node.initializer && ts.isCallExpression(node.initializer)).toBe(true);
        if (node.initializer && ts.isCallExpression(node.initializer)) {
          expect(node.initializer.expression.getText(floor)).toBe('withoutAgentSubturnText');
          const input = unwrap(node.initializer.arguments[0]!);
          expect(ts.isConditionalExpression(input)).toBe(true);
          if (ts.isConditionalExpression(input)) {
            expect(input.condition.getText(floor)).toBe(
              "params.write.expectedRevision === undefined && !Object.prototype.hasOwnProperty.call(write, 'expectedRevision')",
            );
            expect(input.whenTrue.getText(floor)).toBe('write');
            expect(guaranteesRevision(input.whenFalse)).toBe(true);
          }
          forwarded.push(...propertyValues(input, 'expectedRevision').map((value) => value.getText(floor)));
        }
      }
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && node.expression.expression.getText(floor) === 'store'
        && ['append', 'appendIfLatest'].includes(node.expression.name.text)) {
        appendArguments.push(node.arguments[0]!.getText(floor));
      }
      ts.forEachChild(node, visit);
    }
    visit(floor);
    expect(forwarded).toEqual(['params.write.expectedRevision']);
    expect(appendArguments).toEqual(['storedWrite', 'storedWrite']);
  });
});

/** Resolve local RPC aliases/conditional names without accepting comments as code. */
function rpcNames(expression: ts.Expression, scope: ts.Node, seen = new Set<string>()): string[] {
  const value = unwrap(expression);
  if (ts.isStringLiteral(value)) return [value.text];
  if (ts.isConditionalExpression(value)) return [...rpcNames(value.whenTrue, scope, seen), ...rpcNames(value.whenFalse, scope, seen)];
  if (!ts.isIdentifier(value) || seen.has(value.text)) return [];
  const next = new Set(seen).add(value.text);
  let initializer: ts.Expression | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === value.text) initializer = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(scope);
  return initializer ? rpcNames(initializer, scope, next) : [];
}

function hasRevisionFencedSelector(method: ts.MethodDeclaration): boolean {
  const declarations = new Map<string, ts.Expression>();
  for (const statement of method.body?.statements ?? []) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer) declarations.set(declaration.name.text, unwrap(declaration.initializer));
    }
  }
  const flag = declarations.get('revisionChecked');
  const selector = declarations.get('rpcName');
  return flag !== undefined && ts.isCallExpression(flag) && flag.expression.getText() === 'useAppendV6' && flag.arguments.length === 0
    && selector !== undefined && ts.isConditionalExpression(selector) && selector.condition.getText() === 'revisionChecked'
    && ts.isStringLiteral(selector.whenTrue) && selector.whenTrue.text === 'append_turn_atomic_v4r'
    && ts.isStringLiteral(selector.whenFalse) && selector.whenFalse.text === 'append_turn_atomic_v4';
}

/** Legacy RPCs are permitted only after the graph-bearing ON branch returns. */
function legacyGraphRpcEscapes(file: ts.SourceFile): string[] {
  const failures: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'rpc' && node.arguments[0]) {
      let owner: ts.Node | undefined = node.parent;
      while (owner && !ts.isMethodDeclaration(owner)) owner = owner.parent;
      const method = owner && ts.isMethodDeclaration(owner) ? owner : undefined;
      const names = rpcNames(node.arguments[0], method ?? file);
      const legacy = names.filter(name => /^append_turn_atomic_v[234]$/.test(name));
      if (legacy.length > 0) {
        const gate = method?.body?.statements[0];
        const protectedDispatch = method?.name.getText(file) === 'dispatchCheckedAppend'
          && gate && ts.isIfStatement(gate)
          && gate.expression.getText(file) === 'useAppendV6() && write.graph != null'
          && ts.isBlock(gate.thenStatement) && gate.thenStatement.statements.length === 1
          && ts.isReturnStatement(gate.thenStatement.statements[0]!)
          && gate.thenStatement.statements[0]!.getText(file).includes('this.appendAtomicFenced(write, baseRpcArgs, rpcMode, null)');
        const protectedFenced = method?.name.getText(file) === 'appendAtomicFenced'
          && hasRevisionFencedSelector(method) && node.arguments[0].getText(file) === 'rpcName';
        if (!protectedDispatch && !protectedFenced) failures.push(`${file.fileName} ${legacy.join(',')}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return failures;
}

describe('flag-ON graph append RPC closure', () => {
  it('every legacy graph RPC is dominated by the revision dispatch gate', () => {
    expect(CORPUS.flatMap(legacyGraphRpcEscapes)).toEqual([]);
  });
  it('PLANTED MUTANTS: a direct v2/v3/v4 graph RPC and either removed gate are RED', () => {
    for (const rpc of ['v2', 'v3', 'v4']) {
      expect(legacyGraphRpcEscapes(parse('mutant.ts', `client.rpc('append_turn_atomic_${rpc}', { p_graph: graph });`))).toHaveLength(1);
      expect(legacyGraphRpcEscapes(parse('mutant.ts', `const name = 'append_turn_atomic_${rpc}'; client.rpc(name, { p_graph: graph });`))).toHaveLength(1);
    }
    const store = CORPUS.find(file => file.fileName === 'orchestrator-v5/session/supabase-store.ts')!;
    expect(legacyGraphRpcEscapes(parse(store.fileName, store.text.replace(
      'useAppendV6() && write.graph != null', 'false && write.graph != null')))).not.toEqual([]);
    expect(legacyGraphRpcEscapes(parse(store.fileName, store.text.replace(
      "revisionChecked ? 'append_turn_atomic_v4r' : 'append_turn_atomic_v4'", "'append_turn_atomic_v4'") + "\n// const rpcName = revisionChecked ? 'append_turn_atomic_v4r' : 'append_turn_atomic_v4';\n"))).not.toEqual([]);
  });
});
