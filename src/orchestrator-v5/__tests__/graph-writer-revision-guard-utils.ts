import ts from 'typescript';

export function parse(path: string, code: string): ts.SourceFile {
  return ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

export function unwrap(expression: ts.Expression): ts.Expression {
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
export function propertyValues(expression: ts.Expression, key: string): ts.Expression[] {
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
export function guaranteesRevision(expression: ts.Expression, alreadySupplied = false, key = 'expectedRevision'): boolean {
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

/** Track local graph transformations back to their combined-read invocation.
 * When a provenance is known, a later combined read cannot supply its revision.
 * Opaque forwarding seams are covered separately below and by runtime rows.
 */
function readOrigins(expression: ts.Expression, seen = new Set<ts.Node>()): Set<number> {
  const value = unwrap(expression);
  if (seen.has(value)) return new Set();
  const next = new Set(seen).add(value);
  if (ts.isAwaitExpression(value)) return readOrigins(value.expression, next);
  if (ts.isPropertyAccessExpression(value)) return readOrigins(value.expression, next);
  if (ts.isIdentifier(value)) {
    let scope: ts.Node | undefined = value.parent;
    while (scope) {
      const bindings: Array<{ node: ts.Node; expression: ts.Expression }> = [];
      const scan = (node: ts.Node): void => {
        if (node !== scope && ts.isFunctionLike(node)) return;
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
          && node.name.text === value.text && node.initializer && node.getStart() < value.getStart()) {
          bindings.push({ node, expression: node.initializer });
        }
        if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
          && ts.isIdentifier(node.left) && node.left.text === value.text && node.getStart() < value.getStart()) {
          bindings.push({ node, expression: node.right });
        }
        ts.forEachChild(node, scan);
      };
      scan(scope);
      const binding = bindings.sort((a, b) => b.node.getStart() - a.node.getStart())[0];
      if (binding) return readOrigins(binding.expression, next);
      scope = scope.parent;
    }
    return new Set();
  }
  if (ts.isCallExpression(value)) {
    const name = ts.isPropertyAccessExpression(value.expression) ? value.expression.name.text : value.expression.getText();
    if (['loadPersistedScenarioStateStrict', 'loadGraphAndBriefText'].includes(name)) return new Set([value.getStart()]);
    return new Set(value.arguments.flatMap(arg => [...readOrigins(arg, next)]));
  }
  if (ts.isObjectLiteralExpression(value)) return new Set(value.properties.flatMap(property =>
    ts.isPropertyAssignment(property) ? [...readOrigins(property.initializer, next)]
      : ts.isSpreadAssignment(property) ? [...readOrigins(property.expression, next)]
      : ts.isShorthandPropertyAssignment(property) ? [...readOrigins(property.name, next)] : []));
  if (ts.isConditionalExpression(value)) return new Set([
    ...readOrigins(value.whenTrue, next), ...readOrigins(value.whenFalse, next),
  ]);
  return new Set();
}

function revisionMatchesGraphRead(write: ts.Expression): boolean {
  const graphs = propertyValues(write, 'graph').flatMap(value => [...readOrigins(value)]);
  const revisions = propertyValues(write, 'expectedRevision').flatMap(value => [...readOrigins(value)]);
  // A known graph origin MUST have the same known read as its expectation.
  return graphs.length === 0 || (new Set(graphs).size === 1 && revisions.length > 0
    && revisions.every(revision => revision === graphs[0]));
}

interface RevisionDoor {
  readonly path: string;
  readonly line: number;
  readonly target: string;
  readonly hasRevision: boolean;
}

export function revisionDoors(file: ts.SourceFile): RevisionDoor[] {
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
            : mightSupply(write, 'graph');
          if (versioned) doors.push({
            path: file.fileName,
            line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
            target: name!,
            hasRevision: guaranteesRevision(write) && revisionMatchesGraphRead(write),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return doors;
}

