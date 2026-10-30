/**
 * S3: a source-discovered, field-sensitive census of calls that own reply text.
 * The baseline is consumed only by the comparison, never by discovery.
 *
 * Resolve the registered request handler, then slice backwards from each
 * composeReplyShape's text property. Track local bindings (including shadowing),
 * assignments, carrier fields, spreads, destructuring and value expressions;
 * predicates and non-text carrier fields are not reply producers. The slice is
 * conservative across branches: all earlier writes to a binding are retained.
 * Expand directly invoked agent-lane exports once, by their imported export
 * name. Deeper calls are boundaries, not an unbounded transitive census.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import ts from 'typescript';

export const ROUTE_FILE = 'src/routes/agent-v1-turn.ts';
const LANE = 'src/orchestrator-v5/agent-lane';
type FunctionNode = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction;
export type ReplyPath = 'live' | 'replay';
export interface Appender {
  name: string;
  key: string;
  path: ReplyPath;
  locations: { file: string; line: number }[];
}
export interface BaselineRow {
  name: string;
  key: string;
  path: ReplyPath;
  reason: string;
}
interface Write { symbol: ts.Symbol; fields: string[]; value: ts.Expression; at: number }
interface Model {
  file: string;
  source: ts.SourceFile;
  checker: ts.TypeChecker;
  writes: Write[];
  functions: Map<ts.Symbol, FunctionNode>;
  exports: Map<string, FunctionNode>;
  imports: Map<ts.Symbol, { file: string; name: string }>;
}
interface Context {
  model: Model;
  limit: number;
  boundary: number;
  path: ReplyPath;
  depth: number;
  owner: FunctionNode;
  invocation?: string;
  arguments?: Map<ts.Symbol, { expression: ts.Expression; context: Context }>;
}

const unwrap = (value: ts.Expression): ts.Expression => {
  while (ts.isParenthesizedExpression(value) || ts.isAsExpression(value) || ts.isTypeAssertionExpression(value)
    || ts.isNonNullExpression(value) || ts.isAwaitExpression(value) || ts.isSatisfiesExpression(value)) value = value.expression;
  return value;
};
const propertyName = (name: ts.PropertyName): string | undefined =>
  ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) ? name.text : undefined;
const visit = (node: ts.Node, fn: (node: ts.Node) => void): void => {
  fn(node);
  node.forEachChild(child => visit(child, fn));
};
const functionName = (fn: FunctionNode): string => {
  if (fn.name && ts.isIdentifier(fn.name)) return fn.name.text;
  if (ts.isVariableDeclaration(fn.parent) && ts.isIdentifier(fn.parent.name)) return fn.parent.name.text;
  // Callback keys use their enclosing named function, never an unstable offset.
  for (let p: ts.Node | undefined = fn.parent; p; p = p.parent) {
    if (ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) || ts.isArrowFunction(p)) return functionName(p);
  }
  return '<callback>';
};
const nearestFunction = (node: ts.Node): ts.FunctionLikeDeclaration | undefined => {
  for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
    if (ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) || ts.isArrowFunction(p)
      || ts.isMethodDeclaration(p) || ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p)) return p;
  }
  return undefined;
};
const textField = (fields: string[]): boolean => fields.some(field =>
  field === 'assistant_text' || field === 'text' || field === 'reply' || field === 'guided' || field === 'progress' || field === 'say');
const valueReceiver = (call: ts.CallExpression): boolean => ts.isPropertyAccessExpression(call.expression)
  && ['map', 'flatMap', 'filter', 'find', 'join', 'slice', 'substring', 'split', 'trim', 'trimEnd', 'trimStart',
    'replace', 'replaceAll', 'concat', 'toLowerCase', 'toUpperCase', 'at'].includes(call.expression.name.text);
const calleeKey = (input: ts.Expression): string => {
  const expression = unwrap(input);
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return `${calleeKey(expression.expression)}.${expression.name.text}`;
  if (ts.isElementAccessExpression(expression)) return `${calleeKey(expression.expression)}[${expression.argumentExpression ? calleeKey(expression.argumentExpression) : '?'}]`;
  if (ts.isStringLiteral(expression) || ts.isNumericLiteral(expression)) return JSON.stringify(expression.text);
  if (ts.isCallExpression(expression)) return `${calleeKey(expression.expression)}()`;
  return `<${ts.SyntaxKind[expression.kind]}>`;
};

function modelOf(file: string, sourceText: string): Model {
  const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);
  // Bind this AST without loading the service, dependencies, or its prompts.
  const host = ts.createCompilerHost({ noResolve: true, noLib: true });
  host.getSourceFile = name => name === file ? source : undefined;
  const checker = ts.createProgram([file], { noResolve: true, noLib: true }, host).getTypeChecker();
  const model: Model = { file, source, checker, writes: [], functions: new Map(), exports: new Map(), imports: new Map() };
  const target = (node: ts.Expression): { symbol: ts.Symbol; fields: string[] } | undefined => {
    node = unwrap(node);
    if (ts.isIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      return symbol ? { symbol, fields: [] } : undefined;
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const base = target(node.expression);
      const field = ts.isPropertyAccessExpression(node) ? node.name.text
        : node.argumentExpression && ts.isStringLiteral(node.argumentExpression) ? node.argumentExpression.text : undefined;
      return base && field !== undefined ? { symbol: base.symbol, fields: [...base.fields, field] } : undefined;
    }
    return undefined;
  };
  const bind = (name: ts.BindingName, value: ts.Expression, fields: string[] = []): void => {
    if (ts.isIdentifier(name)) {
      const symbol = checker.getSymbolAtLocation(name);
      if (symbol) {
        // A projected expression is synthetic only for destructuring; its source
        // identifiers retain the original bindings and positions.
        let projected = value;
        for (const field of fields) projected = ts.factory.createPropertyAccessExpression(projected, field);
        model.writes.push({ symbol, fields: [], value: projected, at: name.getStart(source) });
      }
    } else if (ts.isObjectBindingPattern(name)) {
      for (const element of name.elements) {
        if (element.dotDotDotToken) bind(element.name, value, fields);
        else {
          const field = element.propertyName ? propertyName(element.propertyName)
            : ts.isIdentifier(element.name) ? element.name.text : undefined;
          if (field !== undefined) bind(element.name, value, [...fields, field]);
        }
      }
    }
  };
  visit(source, node => {
    if (ts.isVariableDeclaration(node) && node.initializer) bind(node.name, node.initializer);
    if (ts.isForOfStatement(node) && ts.isVariableDeclarationList(node.initializer)) {
      for (const declaration of node.initializer.declarations) bind(declaration.name, node.expression);
    }
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.EqualsToken, ts.SyntaxKind.PlusEqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken, ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.AmpersandAmpersandEqualsToken].includes(node.operatorToken.kind)) {
      const left = target(node.left);
      if (left) model.writes.push({ ...left, value: node.right, at: node.getStart(source) });
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'push') {
      const left = target(node.expression.expression);
      if (left) model.writes.push({ ...left, value: ts.factory.createArrayLiteralExpression(node.arguments), at: node.getStart(source) });
    }
    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
      const name = node.name ?? (ts.isVariableDeclaration(node.parent) ? node.parent.name : undefined);
      if (name && ts.isIdentifier(name)) {
        const symbol = checker.getSymbolAtLocation(name);
        if (symbol) model.functions.set(symbol, node);
        const declaration = ts.isVariableDeclaration(node.parent) ? node.parent.parent.parent : node;
        if (ts.canHaveModifiers(declaration) && ts.getModifiers(declaration)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
          model.exports.set(name.text, node);
        }
      }
    }
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) for (const element of bindings.elements) {
        const symbol = checker.getSymbolAtLocation(element.name);
        if (symbol) model.imports.set(symbol, {
          file: join(dirname(file), node.moduleSpecifier.text).split('\\').join('/').replace(/\.js$/, '.ts'),
          name: element.propertyName?.text ?? element.name.text,
        });
      }
    }
    if (ts.isExportDeclaration(node) && !node.moduleSpecifier && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const element of node.exportClause.elements) {
        const symbol = checker.getSymbolAtLocation(element.propertyName ?? element.name);
        const fn = symbol && model.functions.get(symbol);
        if (fn) model.exports.set(element.name.text, fn);
      }
    }
  });
  return model;
}

export function scanReplyAppenders(root: string, routeText = readFileSync(join(root, ROUTE_FILE), 'utf8')): Appender[] {
  const models = new Map<string, Model>();
  const route = modelOf(ROUTE_FILE, routeText);
  models.set(ROUTE_FILE, route);
  const laneFiles = (dir: string): string[] => readdirSync(join(root, dir), { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? entry.name === '__tests__' ? [] : laneFiles(`${dir}/${entry.name}`)
      : entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [`${dir}/${entry.name}`] : []);
  for (const file of laneFiles(LANE)) models.set(file, modelOf(file, readFileSync(join(root, file), 'utf8')));
  const resolveFunction = (expression: ts.Expression, model: Model): { model: Model; fn: FunctionNode; name: string } | undefined => {
    expression = unwrap(expression);
    if (ts.isFunctionExpression(expression) || ts.isArrowFunction(expression)) return { model, fn: expression, name: '<inline>' };
    if (!ts.isIdentifier(expression)) return undefined;
    const symbol = model.checker.getSymbolAtLocation(expression);
    if (!symbol) return undefined;
    const local = model.functions.get(symbol);
    if (local) return { model, fn: local, name: functionName(local) };
    const imported = model.imports.get(symbol);
    const importedModel = imported && models.get(imported.file);
    const fn = importedModel && importedModel.exports.get(imported!.name);
    return fn && importedModel ? { model: importedModel, fn, name: imported!.name } : undefined;
  };

  const registrations: ts.CallExpression[] = [];
  visit(route.source, node => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'post'
      && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === '/agent/v1/turn') registrations.push(node);
  });
  if (registrations.length !== 1) throw new Error('reply-appender probe: expected one /agent/v1/turn registration');
  const candidates = new Set<FunctionNode>();
  const registrationHandler = registrations[0]!.arguments.at(-1)!;
  visit(registrationHandler, node => {
    if (ts.isCallExpression(node)) {
      const resolved = resolveFunction(node.expression, route);
      if (resolved?.fn.body) candidates.add(resolved.fn);
    }
  });
  if (ts.isArrowFunction(registrationHandler) || ts.isFunctionExpression(registrationHandler)) candidates.add(registrationHandler);
  const composersIn = (fn: FunctionNode): ts.CallExpression[] => {
    const calls: ts.CallExpression[] = [];
    if (fn.body) visit(fn.body, node => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'composeReplyShape') calls.push(node);
    });
    return calls;
  };
  const handlers = [...candidates].filter(fn => composersIn(fn).length > 0);
  if (handlers.length !== 1) throw new Error('reply-appender probe: registered request handler was not uniquely resolved');
  const handler = handlers[0]!;
  const composers = composersIn(handler);
  if (composers.length !== 2) throw new Error(`reply-appender probe: expected live and replay composers, found ${composers.length}`);
  if (composers.filter(call => nearestFunction(call) === handler).length !== 1) throw new Error('reply-appender probe: missing unique live composer');

  const found = new Map<string, Appender>();
  const seen = new Map<string, boolean>();
  const symbolIds = new Map<ts.Symbol, number>();
  const symbolId = (symbol: ts.Symbol): number => {
    if (!symbolIds.has(symbol)) symbolIds.set(symbol, symbolIds.size);
    return symbolIds.get(symbol)!;
  };
  const record = (call: ts.CallExpression, ctx: Context): void => {
    // Route helper definitions outside the registered handler are not call sites
    // in scope. Direct lane export bodies are the one permitted indirection.
    const inRouteScope = ctx.model === route && call.pos >= handler.pos && call.end <= ctx.boundary;
    if (!inRouteScope && !(ctx.model.file.startsWith(`${LANE}/`) && ctx.depth === 1)) return;
    const resolved = resolveFunction(call.expression, ctx.model);
    // The extra lane census is by function/export name. Native string/array
    // methods are already covered by their route owner, not lane exports.
    if (!inRouteScope) {
      if (!resolved || !resolved.model.file.startsWith(`${LANE}/`)) return;
      const signature = resolved.model.checker.getSignatureFromDeclaration(resolved.fn);
      const returnsText = (type: ts.Type): boolean => {
        if (type.flags & ts.TypeFlags.StringLike) return true;
        if (type.isUnion()) return type.types.some(returnsText);
        return false;
      };
      const resultType = signature && resolved.model.checker.getReturnTypeOfSignature(signature);
      let isWriter = resultType && (returnsText(resultType) || resultType.getProperties().some(property =>
        textField([property.name]) && returnsText(resolved.model.checker.getTypeOfSymbolAtLocation(property, resolved.fn))));
      // Generic egress carriers and string arrays may not resolve without libs.
      if (resolved.fn.type && ts.isArrayTypeNode(resolved.fn.type) && resolved.fn.type.elementType.kind === ts.SyntaxKind.StringKeyword) isWriter = true;
      if (resolved.fn.body) visit(resolved.fn.body, node => {
        if (ts.isPropertyAssignment(node) && propertyName(node.name) === 'assistant_text') isWriter = true;
      });
      if (!isWriter) return;
    }
    const name = resolved?.name ?? calleeKey(call.expression);
    const enclosing = nearestFunction(call);
    const owner = enclosing && (ts.isFunctionDeclaration(enclosing) || ts.isFunctionExpression(enclosing) || ts.isArrowFunction(enclosing)) ? enclosing : ctx.owner;
    const key = `${ctx.model.file}#${functionName(owner)}->${name}`;
    const identity = `${ctx.path}:${key}`;
    const row = found.get(identity) ?? { name, key, path: ctx.path, locations: [] };
    const line = ctx.model.source.getLineAndCharacterOfPosition(call.getStart(ctx.model.source)).line + 1;
    if (!row.locations.some(location => location.line === line)) row.locations.push({ file: ctx.model.file, line });
    found.set(identity, row);
  };

  const trace = (input: ts.Expression, fields: string[], ctx: Context): boolean => {
    const expression = unwrap(input);
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return fields.length === 0;
    if (ts.isIdentifier(expression)) {
      const symbol = ctx.model.checker.getSymbolAtLocation(expression);
      if (!symbol) return fields.length === 0;
      const mapped = ctx.arguments?.get(symbol);
      if (mapped) {
        const param = symbol.valueDeclaration;
        const stringParameter = param && ts.isParameter(param) && param.type?.getText(ctx.model.source).includes('string');
        return (textField(fields) || !!stringParameter) && trace(mapped.expression, fields, mapped.context);
      }
      const id = `${ctx.model.file}:${symbolId(symbol)}:${fields.join('.')}:${ctx.limit}:${ctx.path}:${ctx.depth}:${ctx.invocation}`;
      if (seen.has(id)) return seen.get(id)!;
      seen.set(id, false);
      let reachesText = false;
      const writes = ctx.model.writes.filter(write => write.symbol === symbol && write.at < ctx.limit);
      for (const write of writes) {
        if (write.fields.every((field, i) => field === fields[i])) {
          const reaches = trace(write.value, fields.slice(write.fields.length), { ...ctx, limit: write.at });
          reachesText = reaches || reachesText;
        }
      }
      reachesText = reachesText || (writes.length === 0 && fields.length === 0);
      seen.set(id, reachesText);
      return reachesText;
    }
    if (ts.isPropertyAccessExpression(expression)) return trace(expression.expression, [expression.name.text, ...fields], ctx);
    if (ts.isElementAccessExpression(expression)) {
      return !!expression.argumentExpression && (ts.isStringLiteral(expression.argumentExpression) || ts.isNumericLiteral(expression.argumentExpression))
        && trace(expression.expression, [expression.argumentExpression.text, ...fields], ctx);
    }
    if (ts.isObjectLiteralExpression(expression)) {
      let reachesText = false;
      for (const property of expression.properties) {
        let reaches = false;
        if (ts.isSpreadAssignment(property)) reaches = trace(property.expression, fields, ctx);
        else if (ts.isPropertyAssignment(property) && fields[0] === propertyName(property.name)) reaches = trace(property.initializer, fields.slice(1), ctx);
        else if (ts.isShorthandPropertyAssignment(property) && fields[0] === property.name.text) reaches = trace(property.name, fields.slice(1), ctx);
        reachesText = reaches || reachesText;
      }
      return reachesText;
    }
    if (ts.isConditionalExpression(expression)) {
      const left = trace(expression.whenTrue, fields, ctx);
      const right = trace(expression.whenFalse, fields, ctx);
      return left || right;
    }
    if (ts.isBinaryExpression(expression)) {
      if ([ts.SyntaxKind.PlusToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(expression.operatorToken.kind)) {
        const left = trace(expression.left, fields, ctx);
        const right = trace(expression.right, fields, ctx);
        return left || right;
      }
      return false;
    }
    if (ts.isTemplateExpression(expression)) {
      for (const span of expression.templateSpans) trace(span.expression, [], ctx);
      return fields.length === 0;
    }
    if (ts.isArrayLiteralExpression(expression)) {
      let reachesText = false;
      const index = fields.length > 0 ? Number(fields[0]) : NaN;
      const elements = Number.isInteger(index) ? [expression.elements[index]].filter((element): element is ts.Expression => !!element) : expression.elements;
      for (const element of elements) {
        const reaches = trace(ts.isSpreadElement(element) ? element.expression : element, Number.isInteger(index) ? fields.slice(1) : fields, ctx);
        reachesText = reaches || reachesText;
      }
      return reachesText;
    }
    if (!ts.isCallExpression(expression)) return false;
    const resolved = resolveFunction(expression.expression, ctx.model);
    let reachesText = !resolved;
    if (resolved?.fn.body && ctx.depth < 4) {
      const args = new Map<ts.Symbol, { expression: ts.Expression; context: Context }>();
      resolved.fn.parameters.forEach((param, index) => {
        const symbol = resolved.model.checker.getSymbolAtLocation(param.name);
        const arg = param.dotDotDotToken ? ts.factory.createArrayLiteralExpression(expression.arguments.slice(index)) : expression.arguments[index] ?? param.initializer;
        if (symbol && arg) args.set(symbol, { expression: arg, context: arg === param.initializer
          ? { ...ctx, model: resolved.model, depth: ctx.depth + 1, owner: resolved.fn, limit: resolved.fn.end }
          : { ...ctx, limit: Math.min(ctx.limit, expression.getStart(ctx.model.source)) } });
      });
      const inner: Context = { model: resolved.model, owner: resolved.fn, limit: resolved.fn.end, boundary: ctx.boundary,
        path: ctx.path, depth: ctx.depth + 1, arguments: args, invocation: `${ctx.invocation ?? ''}>${ctx.model.file}:${expression.pos}` };
      if (ts.isBlock(resolved.fn.body)) visit(resolved.fn.body, node => {
        if (ts.isReturnStatement(node) && node.expression && nearestFunction(node) === resolved.fn) {
          const reaches = trace(node.expression, fields, inner);
          reachesText = reaches || reachesText;
        }
      });
      else reachesText = trace(resolved.fn.body, fields, inner);
    } else {
      // Unknown call results are a conservative boundary. Preserve carrier
      // fields on the first input; method receivers carry values, their numeric
      // indices and predicate callback results do not supply reply text.
      if (ts.isPropertyAccessExpression(expression.expression) && valueReceiver(expression)) trace(expression.expression.expression, fields, ctx);
      else if (expression.arguments[0]) trace(expression.arguments[0], fields, ctx);
      expression.arguments.forEach((arg, index) => {
        const parameter = resolved?.fn.parameters[index];
        const placesText = parameter?.type && ts.isFunctionTypeNode(parameter.type)
          && parameter.type.type.getText(resolved!.model.source).includes('string');
        const mapsValues = ts.isPropertyAccessExpression(expression.expression) && ['map', 'flatMap'].includes(expression.expression.name.text);
        if ((ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) && (placesText || mapsValues)) {
          if (ts.isBlock(arg.body)) visit(arg.body, node => {
            if (ts.isReturnStatement(node) && node.expression && nearestFunction(node) === arg) trace(node.expression, fields, ctx);
          });
          else trace(arg.body, fields, ctx);
        }
        if (ts.isObjectLiteralExpression(arg)) trace(arg, fields, ctx);
      });
    }
    // Placement callbacks passed to an expanded export remain route call sites.
    expression.arguments.forEach((arg, index) => {
      const parameter = resolved?.fn.parameters[index];
      const placesText = parameter?.type && ts.isFunctionTypeNode(parameter.type)
        && parameter.type.type.getText(resolved!.model.source).includes('string');
      if (ts.isArrowFunction(arg) && !ts.isBlock(arg.body) && placesText) trace(arg.body, [], ctx);
    });
    if (reachesText) record(expression, ctx);
    return reachesText;
  };
  for (const composer of composers) {
    const input = composer.arguments[0];
    if (!input || !ts.isObjectLiteralExpression(input)) throw new Error('reply-appender probe: composer input is not an object literal');
    const text = input.properties.find(property => ts.isPropertyAssignment(property) && propertyName(property.name) === 'text');
    if (!text || !ts.isPropertyAssignment(text)) throw new Error('reply-appender probe: composer text input is missing');
    trace(text.initializer, [], { model: route, limit: composer.getStart(route.source), boundary: composer.getStart(route.source), path: nearestFunction(composer) === handler ? 'live' : 'replay', depth: 0, owner: handler });
  }
  return [...found.values()].map(row => ({ ...row, locations: row.locations.sort((a, b) => a.line - b.line) }))
    .sort((a, b) => `${a.path}:${a.key}`.localeCompare(`${b.path}:${b.key}`));
}

export function assertReplyAppenderBaseline(found: Appender[], baseline: BaselineRow[]): void {
  const identity = (row: Pick<BaselineRow, 'key' | 'path'>): string => `${row.path}:${row.key}`;
  const expected = new Map(baseline.map(row => [identity(row), row]));
  if (expected.size !== baseline.length) throw new Error('reply-appender baseline contains duplicate owner/path keys');
  for (const row of baseline) if (!row.name || !row.key || !['live', 'replay'].includes(row.path) || !row.reason?.trim()) {
    throw new Error('reply-appender baseline requires name, key, path and a nonempty migration reason');
  }
  const actual = new Map(found.map(row => [identity(row), row]));
  const added = found.filter(row => !expected.has(identity(row)));
  const stale = baseline.filter(row => !actual.has(identity(row)));
  const renamed = found.filter(row => expected.has(identity(row)) && expected.get(identity(row))!.name !== row.name);
  if (added.length || stale.length || renamed.length) throw new Error([
    ...added.map(row => `New reply appender ${identity(row)}: move it into a typed composer input, or add it to the baseline with reviewer sign-off`),
    ...stale.map(row => `Stale reply appender ${identity(row)}: ratchet down; delete it from the baseline`),
    ...renamed.map(row => `Reply appender name differs from baseline: ${identity(row)}`),
  ].join('\n'));
  if (found.length < baseline.length || found.length === 0 || !['withA7AfterGate', 'withCellHorizon'].every(name => found.some(row => row.name === name))) {
    throw new Error('reply-appender positive control failed: census must find >= baseline length and withA7AfterGate + withCellHorizon; zero is a broken probe');
  }
}
