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

function parse(path: string, code: string): ts.SourceFile {
  return ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function unwrap(expression: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression)
    || ts.isTypeAssertionExpression(expression) || ts.isNonNullExpression(expression)) {
    expression = expression.expression;
  }
  return expression;
}

function propertyName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
}

/** Inspect object properties and spread branches, never comments or nested objects. */
function propertyValues(expression: ts.Expression, key: string): ts.Expression[] {
  const object = unwrap(expression);
  if (ts.isConditionalExpression(object)) {
    return [...propertyValues(object.whenTrue, key), ...propertyValues(object.whenFalse, key)];
  }
  if (!ts.isObjectLiteralExpression(object)) return [];
  return object.properties.flatMap((property) => {
    if (ts.isSpreadAssignment(property)) return propertyValues(property.expression, key);
    if (propertyName(property.name) !== key) return [];
    if (ts.isPropertyAssignment(property)) return [property.initializer];
    if (ts.isShorthandPropertyAssignment(property)) return [property.name];
    return [];
  });
}

function isRevisionValue(expression: ts.Expression): boolean {
  const value = unwrap(expression);
  // A presence-only guard would accept these and silently weaken the CAS.
  if (value.kind === ts.SyntaxKind.NullKeyword
    || (ts.isIdentifier(value) && value.text === 'undefined')
    || ts.isVoidExpression(value) || ts.isNumericLiteral(value)) return false;
  if (ts.isBinaryExpression(value) && (value.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
    || value.operatorToken.kind === ts.SyntaxKind.BarBarToken)) return false;
  return true;
}

function isKnownHashOnlySpread(expression: ts.Expression): boolean {
  const value = unwrap(expression);
  return ts.isCallExpression(value) && ts.isIdentifier(value.expression)
    && value.expression.text === 'computeExpectedGraphCasHashes';
}

/** An opaque argument/spread might carry a graph; absence is not an exemption. */
function mightSupply(expression: ts.Expression, key: string): boolean {
  const value = unwrap(expression);
  if (isKnownHashOnlySpread(value)) return false;
  if (ts.isConditionalExpression(value)) return mightSupply(value.whenTrue, key) || mightSupply(value.whenFalse, key);
  if (!ts.isObjectLiteralExpression(value)) return true;
  return value.properties.some((property) => ts.isSpreadAssignment(property)
    ? mightSupply(property.expression, key) : propertyName(property.name) === key);
}

/** Omit only the same undefined expectation; arbitrary conditional omission is unsafe. */
function omitsOnlyUndefinedRevision(expression: ts.ConditionalExpression, key: string): boolean {
  if (key !== 'expectedRevision') return false;
  const condition = unwrap(expression.condition);
  const present = unwrap(expression.whenTrue);
  const absent = unwrap(expression.whenFalse);
  if (!ts.isBinaryExpression(condition) || condition.operatorToken.kind !== ts.SyntaxKind.ExclamationEqualsEqualsToken
    || !ts.isIdentifier(condition.right) || condition.right.text !== 'undefined'
    || !ts.isObjectLiteralExpression(present) || present.properties.length !== 1
    || !ts.isObjectLiteralExpression(absent) || absent.properties.length !== 0) return false;
  const property = present.properties[0]!;
  if (ts.isSpreadAssignment(property) || propertyName(property.name) !== key) return false;
  const revision = ts.isPropertyAssignment(property) ? property.initializer
    : ts.isShorthandPropertyAssignment(property) ? property.name : undefined;
  return revision !== undefined && isRevisionValue(revision)
    && unwrap(revision).getText() === unwrap(condition.left).getText();
}

/** Follow property order; conditional omission is allowed only for an undefined expectation. */
function guaranteesRevision(expression: ts.Expression, alreadySupplied = false, key = 'expectedRevision'): boolean {
  const value = unwrap(expression);
  if (isKnownHashOnlySpread(value)) return alreadySupplied;
  if (ts.isConditionalExpression(value)) {
    if (omitsOnlyUndefinedRevision(value, key)) return true;
    return guaranteesRevision(value.whenTrue, alreadySupplied, key) && guaranteesRevision(value.whenFalse, alreadySupplied, key);
  }
  if (!ts.isObjectLiteralExpression(value)) return false;
  let supplied = alreadySupplied;
  for (const property of value.properties) {
    if (ts.isSpreadAssignment(property)) supplied = guaranteesRevision(property.expression, supplied, key);
    else if (propertyName(property.name) === key) {
      supplied = ts.isPropertyAssignment(property) ? isRevisionValue(property.initializer)
        : ts.isShorthandPropertyAssignment(property) && isRevisionValue(property.name);
    }
  }
  return supplied;
}

interface RevisionDoor {
  readonly path: string;
  readonly line: number;
  readonly target: string;
  readonly hasRevision: boolean;
}

function revisionDoors(file: ts.SourceFile): RevisionDoor[] {
  const importedNames = new Map<string, string>();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const binding of bindings.elements) {
      importedNames.set(binding.name.text, binding.propertyName?.text ?? binding.name.text);
    }
  }
  const doors: RevisionDoor[] = [];
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const name = ts.isIdentifier(node.expression)
        ? importedNames.get(node.expression.text) ?? node.expression.text : undefined;
      const argument = name === 'commitDirectAnswer' ? node.arguments[1]
        : name === 'appendCheckedGraphWrite' ? node.arguments[0] : undefined;
      if (argument) {
        const writes = name === 'appendCheckedGraphWrite' ? propertyValues(argument, 'write') : [argument];
        if (name === 'appendCheckedGraphWrite' && writes.length === 0 && mightSupply(argument, 'write')) writes.push(argument);
        for (const write of writes) {
          // A graph-bearing commit can build the version carrier. A direct
          // floor caller reaches v5/v6 only when it supplies that carrier.
          const versioned = name === 'commitDirectAnswer' ? mightSupply(write, 'graph')
            : mightSupply(write, 'modelVersion');
          if (versioned) doors.push({
            path: file.fileName,
            line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
            target: name!,
            hasRevision: guaranteesRevision(write),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return doors;
}

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
