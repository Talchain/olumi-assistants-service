/**
 * GUIDED PATH r11: discover Agent conversation output/storage/reload writers
 * in the LIVE tree, including new untracked modules. Each sink must derive its
 * assistant text from withEstimateGoalPointsAtEgress, not merely import it or
 * have an unrelated call elsewhere in the file. Like the CEE authority/wiring
 * scanners, use the shared comment stripper, a non-vacuous source population,
 * and permanent positive controls over the same scanner.
 *
 * Scope: agent routes, the scenario-graph conversation restore, and every
 * agent-lane module. Raw in-process model/tool producers are upstream of these
 * sinks; durable historical seed is model INPUT, not user-visible replay.
 * Error/claim rows without assistant text and board edits stored as USER
 * history are not assistant writers. No transport writer is name-allowlisted.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { stripComments, GUARD_WALK_TIMEOUT_MS } from '../../../../scripts/ci/strip-source-comments.mjs';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const GATE = 'withEstimateGoalPointsAtEgress';
const ROUTE = 'src/routes/agent-v1-turn.ts';
const RELOAD = 'src/routes/assist.v1.scenario-graph.ts';
type Source = { rel: string; text: string };
type Sink = { rel: string; line: number; kind: string; qualified: boolean };

function sources(): Source[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      if (entry.name === '__tests__') continue;
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (/\.tsx?$/.test(entry.name) && !/\.(?:test|d)\.ts$/.test(entry.name)) files.push(rel);
    }
  };
  walk('src/orchestrator-v5/agent-lane');
  walk('src/routes');
  const all = files.sort().map(rel => ({ rel, text: readFileSync(join(ROOT, rel), 'utf8') }));
  const included = all
    .filter(({ rel, text }) => rel.startsWith('src/orchestrator-v5/agent-lane/') || rel === RELOAD
      || /(?:^|\/)agent[^/]*\.tsx?$/.test(rel) || /\b(?:app|fastify)\.post\(\s*['"]\/agent\/v1\//.test(stripComments(text)));
  const byPath = new Map(all.map(source => [source.rel, source]));
  const seen = new Set(included.map(source => source.rel));
  // A newly imported route helper must not escape discovery because its
  // filename does not begin with agent. Resolve only src/routes dependencies;
  // general legacy orchestrator transport is outside this Agent-lane guard.
  for (let i = 0; i < included.length; i++) {
    const input = included[i]!;
    const ast = ts.createSourceFile(input.rel, stripComments(input.text), ts.ScriptTarget.ES2022, true);
    for (const node of ast.statements) {
      if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) continue;
      if (!node.moduleSpecifier || !ts.isStringLiteralLike(node.moduleSpecifier)) continue;
      const imported = node.moduleSpecifier.text;
      if (!imported.startsWith('.')) continue;
      const rel = join(dirname(input.rel), imported.replace(/\.js$/, '.ts'));
      const dependency = byPath.get(rel);
      if (rel.startsWith('src/routes/') && dependency && !seen.has(rel)) {
        seen.add(rel); included.push(dependency);
      }
    }
  }
  return included.sort((a, b) => a.rel.localeCompare(b.rel));
}

/** An AST walk sees code, never a comment or a string that names a sink. */
function scan({ rel, text }: Source): Sink[] {
  if (!/\.(?:send|append)\s*\(|\bassistant(?:Message|_message)\s*:|\b(?:historyWithSentText|methodTurnItems|persistCompleteTurn|appendCheckedGraphWrite)\s*\(/.test(stripComments(text))) return [];
  const source = ts.createSourceFile(rel, stripComments(text), ts.ScriptTarget.ES2022, true);
  const nodes: ts.Node[] = [];
  const visit = (node: ts.Node): void => { nodes.push(node); ts.forEachChild(node, visit); };
  visit(source);
  const name = (node: ts.Node): string | undefined =>
    ts.isIdentifier(node) || ts.isStringLiteralLike(node) ? node.text
      : ts.isComputedPropertyName(node) && ts.isStringLiteralLike(node.expression) ? node.expression.text : undefined;
  const owner = (node: ts.Node): ts.Node => {
    for (let p = node.parent; p; p = p.parent) if (ts.isFunctionLike(p)) return p;
    return source;
  };
  const unwrap = (node: ts.Expression): ts.Expression =>
    ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)
      || ts.isAwaitExpression(node) ? unwrap(node.expression) : node;
  const declarations = (ident: string, before: ts.Node): ts.Expression | undefined => {
    const containingOwners = new Set<ts.Node>([source]);
    for (let p: ts.Node | undefined = before; p; p = p.parent) if (ts.isFunctionLike(p)) containingOwners.add(p);
    const candidates = nodes.filter(node => node.end < before.getStart() && containingOwners.has(owner(node))
      && ((ts.isVariableDeclaration(node) && node.initializer !== undefined && (name(node.name) === ident
        || ts.isObjectBindingPattern(node.name) && node.name.elements.some(e => name(e.name) === ident)))
        || ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && name(node.left) === ident));
    const latest = candidates.sort((a, b) => b.getStart() - a.getStart())[0];
    return latest === undefined ? undefined : ts.isVariableDeclaration(latest) ? latest.initializer : (latest as ts.BinaryExpression).right;
  };
  const isEmpty = (expr: ts.Expression): boolean => expr.kind === ts.SyntaxKind.NullKeyword
    || ts.isIdentifier(expr) && expr.text === 'undefined' || ts.isStringLiteralLike(expr) && expr.text === '';
  const property = (obj: ts.ObjectLiteralExpression, key: string): ts.Expression | undefined => {
    const prop = obj.properties.find(p => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && name(p.name) === key);
    return prop && ts.isPropertyAssignment(prop) ? prop.initializer
      : prop && ts.isShorthandPropertyAssignment(prop) ? prop.name : undefined;
  };
  const noAssistantCarrier = (input: ts.Expression): boolean => {
    const expr = unwrap(input);
    if (isEmpty(expr)) return true;
    if (ts.isConditionalExpression(expr)) return noAssistantCarrier(expr.whenTrue) && noAssistantCarrier(expr.whenFalse);
    if (ts.isCallExpression(expr)) {
      const fn = unwrap(expr.expression);
      if (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) {
        if (!ts.isBlock(fn.body)) return noAssistantCarrier(fn.body);
        const returns = nodes.filter(n => ts.isReturnStatement(n) && owner(n) === fn && n.expression !== undefined) as ts.ReturnStatement[];
        return returns.length > 0 && returns.every(r => noAssistantCarrier(r.expression!));
      }
    }
    return ts.isObjectLiteralExpression(expr)
      && !['assistant_text', 'assistantMessage', 'assistant_message'].some(key => property(expr, key) !== undefined)
      && expr.properties.every(p => ts.isSpreadAssignment(p) || name(p.name) !== undefined)
      && expr.properties.filter(ts.isSpreadAssignment).every(p => noAssistantCarrier(p.expression));
  };

  // A deliberately bounded provenance walk: no arbitrary function is assumed
  // text-preserving. The composer is allowed only through its own text input.
  const qualified = (input: ts.Expression, before: ts.Node = input, depth = 0): boolean => {
    if (depth > 60) return false;
    const expr = unwrap(input);
    const recur = (value: ts.Expression, at: ts.Node = value): boolean => qualified(value, at, depth + 1);
    if (isEmpty(expr)) return true;
    if (ts.isIdentifier(expr)) {
      const value = declarations(expr.text, before);
      return value !== undefined && recur(value);
    }
    if (ts.isPropertyAccessExpression(expr)) return recur(expr.expression);
    if (ts.isConditionalExpression(expr)) return recur(expr.whenTrue) && recur(expr.whenFalse);
    if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
      const left = unwrap(expr.left);
      // The route's existing string carrier is pinned; new raw fallback prose
      // is not qualified merely because a different branch crossed the gate.
      const routeStringCarrier = rel === ROUTE && ts.isPropertyAccessExpression(left)
        && name(left.expression) === 'wireBody' && left.name.text === 'assistant_text' && name(expr.right) === 'text';
      return recur(expr.left) && (isEmpty(expr.right) || routeStringCarrier);
    }
    if (ts.isObjectLiteralExpression(expr)) {
      let carrier: boolean | undefined;
      for (const prop of expr.properties) {
        if ((ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop))
          && ['assistant_text', 'assistant_message', 'assistantMessage'].includes(name(prop.name) ?? '')) {
          carrier = recur(ts.isPropertyAssignment(prop) ? prop.initializer : prop.name);
        } else if (!ts.isSpreadAssignment(prop) && name(prop.name) === undefined) {
          carrier = false;
        } else if (ts.isSpreadAssignment(prop) && !noAssistantCarrier(prop.expression)) {
          // JavaScript's LAST carrier controls the emitted text. An unknown
          // later spread can override an earlier gated body's assistant_text.
          carrier = recur(prop.expression);
        }
      }
      return carrier === true;
    }
    if (ts.isCallExpression(expr)) {
      const callee = name(expr.expression);
      if (callee === GATE) return true;
      if (['String', 'withShapeOnlyIfItDerives', 'finaliseV5Response'].includes(callee ?? '')) {
        return expr.arguments[0] !== undefined && recur(expr.arguments[0]);
      }
      if (callee === 'composeReplyShape') {
        const opts = expr.arguments[0];
        const textInput = opts && ts.isObjectLiteralExpression(opts) ? property(opts, 'text') : undefined;
        return textInput !== undefined && recur(textInput);
      }
      if (callee !== undefined) {
        const declaration = nodes.find(n => ts.isVariableDeclaration(n) && name(n.name) === callee
          && n.initializer !== undefined && ts.isArrowFunction(n.initializer)
          || ts.isFunctionDeclaration(n) && n.name?.text === callee);
        const fn = declaration && ts.isVariableDeclaration(declaration) ? declaration.initializer : declaration;
        if (fn && ts.isFunctionLike(fn)) {
          // A reload function returns a turns array; every assistant projection
          // in that function must cross the same gate. A replay returns its body.
          const projections = nodes.filter(n => ts.isPropertyAssignment(n) && name(n.name) === 'assistant_message'
            && n.getStart() >= fn.getStart() && n.end <= fn.end) as ts.PropertyAssignment[];
          if (projections.length > 0) return projections.every(p => recur(p.initializer));
          const returns = nodes.filter(n => ts.isReturnStatement(n) && owner(n) === fn && n.expression !== undefined) as ts.ReturnStatement[];
          return returns.length > 0 && returns.every(r => recur(r.expression!));
        }
      }
    }
    return false;
  };
  const sinks: Sink[] = [];
  const add = (node: ts.Node, kind: string, expr: ts.Expression): void => {
    sinks.push({ rel, line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, kind, qualified: qualified(expr) });
  };
  for (const node of nodes) {
    if (ts.isPropertyAssignment(node) && ['assistantMessage', 'assistant_message'].includes(name(node.name) ?? '') && !isEmpty(node.initializer)) {
      add(node, name(node.name) === 'assistantMessage' ? 'persist' : 'reload', node.initializer);
    }
    if (!ts.isCallExpression(node)) continue;
    const callName = ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : name(node.expression);
    if (['append', 'persistCompleteTurn', 'appendCheckedGraphWrite'].includes(callName ?? '')) {
      const options = node.arguments[0];
      if (options !== undefined) {
        const row = ts.isObjectLiteralExpression(unwrap(options))
          ? property(unwrap(options) as ts.ObjectLiteralExpression, 'write') ?? options : options;
        if (!noAssistantCarrier(row)) add(node, 'persist', row);
      }
    }
    if (ts.isIdentifier(node.expression) && ['historyWithSentText', 'methodTurnItems'].includes(node.expression.text)) {
      const textArg = node.arguments[node.expression.text === 'methodTurnItems' ? 2 : 1];
      if (textArg) add(node, 'assistant history', textArg);
    }
    if (!ts.isPropertyAccessExpression(node.expression) || node.expression.name.text !== 'send') continue;
    const arg = node.arguments[0];
    if (!arg) continue;
    const expr = unwrap(arg);
    // Typed transport errors cannot carry assistant narration.
    if (ts.isObjectLiteralExpression(expr) && property(expr, 'error') !== undefined
      && noAssistantCarrier(expr)) continue;
    if (ts.isCallExpression(expr) && name(expr.expression) === 'buildErrorV1') continue;
    if (ts.isPropertyAccessExpression(expr) && expr.name.text === 'error') continue;
    if (rel === RELOAD && ts.isObjectLiteralExpression(expr)) {
      const conversation = nodes.filter(n => ts.isPropertyAssignment(n) && name(n.name) === 'conversation_turns'
        && n.getStart() >= expr.getStart() && n.end <= expr.end) as ts.PropertyAssignment[];
      if (conversation.length > 0) { for (const p of conversation) add(p, 'replay send', p.initializer); continue; }
    }
    add(node, 'assistant send', arg);
  }
  return sinks;
}

const unqualified = (inputs: readonly Source[]): Sink[] => inputs.flatMap(scan).filter(sink => !sink.qualified);
const checkedSources = sources();

describe('estimate goal points: every discovered assistant writer uses the ONE chokepoint', () => {
  it('discovers a real source population and every live/replay/history/storage/reload class', () => {
    expect(checkedSources.length).toBeGreaterThan(100);
    expect(checkedSources.map(s => s.rel)).toEqual(expect.arrayContaining([ROUTE, RELOAD]));
    const sinks = checkedSources.flatMap(scan);
    expect(sinks.length).toBeGreaterThanOrEqual(10);
    expect(new Set(sinks.map(s => s.kind))).toEqual(new Set(['assistant send', 'assistant history', 'persist', 'reload', 'replay send']));
  }, GUARD_WALK_TIMEOUT_MS);

  it('all discovered writers derive their assistant text from the chokepoint', () => {
    expect(unqualified(checkedSources)).toEqual([]);
  }, GUARD_WALK_TIMEOUT_MS);

  it('a NEW bypass writer goes RED; a new writer using the chokepoint is GREEN', () => {
    const rel = relative(ROOT, join(ROOT, 'src/orchestrator-v5/agent-lane/new-reply-writer.ts'));
    const bypass = { rel, text: 'export function newWriter(reply: Reply) { return reply.send({ assistant_text: "Chance: 67%." }); }' };
    expect(unqualified([...checkedSources, bypass])).toEqual(expect.arrayContaining([expect.objectContaining({ rel, kind: 'assistant send' })]));
    expect(unqualified([{ rel, text: `export function newWriter(reply: Reply, context: Context) {
      const body = ${GATE}({ assistant_text: "Chance: 67%." }, context); return reply.send(body);
    }` }])).toEqual([]);
  }, GUARD_WALK_TIMEOUT_MS);

  it('MUTANT: removing the call from the existing replay writer goes RED', () => {
    const source = checkedSources.find(s => s.rel === ROUTE)!;
    const marker = `const gatedReplay = ${GATE}(optionGatedReplay, {`;
    expect(source.text).toContain(marker);
    const ast = ts.createSourceFile(source.rel, source.text, ts.ScriptTarget.ES2022, true);
    let call: ts.CallExpression | undefined;
    const find = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'gatedReplay'
        && node.initializer !== undefined && ts.isCallExpression(node.initializer)) call = node.initializer;
      ts.forEachChild(node, find);
    };
    find(ast);
    expect(call).toBeDefined();
    const mutant = { ...source, text: `${source.text.slice(0, call!.getStart())}optionGatedReplay${source.text.slice(call!.end)}` };
    expect(unqualified([mutant]).filter(s => s.kind === 'assistant send')).toHaveLength(3);
  });

  it('later unknown spreads and raw nullish fallbacks cannot override a gated carrier', () => {
    const rel = 'src/orchestrator-v5/agent-lane/new-writer.ts';
    for (const payload of [
      `{ ...${GATE}(body, context), ...unguardedBody }`,
      `{ ...${GATE}(body, context), assistant_text: 'raw override' }`,
      `{ ...${GATE}(body, context), ...{ ['assistant_text']: 'raw computed override' } }`,
      `{ ...${GATE}(body, context), ...{ assistant_text } }`,
      `{ ...${GATE}(body, context), ...{ [key]: 'unknown override' } }`,
      `{ assistant_text: ${GATE}(body, context).assistant_text ?? 'raw fallback' }`,
    ]) expect(unqualified([{ rel, text: `function writer(reply: Reply) { return reply.send(${payload}); }` }])).toHaveLength(1);
    expect(unqualified([{ rel, text: `function writer(reply: Reply) { return reply.send({
      ...${GATE}(body, context), ...(flag ? { metadata: true } : {}),
    }); }` }])).toEqual([]);
  });

  it('new persistence and reload assistant writers are discovered and RED without the gate', () => {
    const rel = 'src/orchestrator-v5/agent-lane/new-writer.ts';
    expect(unqualified([{ rel, text: `function persist(store: Store) { store.append({ assistantMessage: 'raw turn' }); }
      function replay(row: Row) { return { assistant_message: row.assistant_message }; }` }]))
      .toEqual([expect.objectContaining({ kind: 'persist' }), expect.objectContaining({ kind: 'persist' }), expect.objectContaining({ kind: 'reload' })]);
    for (const write of ['store.append(turn)', 'persistCompleteTurn({ write: turn })', 'appendCheckedGraphWrite({ write: turn })']) {
      expect(unqualified([{ rel, text: `function bypass(store: Store, turn: Turn) { ${write}; }` }]))
        .toEqual([expect.objectContaining({ kind: 'persist', qualified: false })]);
    }
    expect(unqualified([{ rel, text: `function reserve(store: Store) {
      appendCheckedGraphWrite({ write: { turn_id: 'claim', response_emitted: false } });
    }` }])).toEqual([]);
  });

  it('comments and an unrelated gate call cannot license a bypass', () => {
    expect(unqualified([{ rel: 'new.ts', text: `function bypass(reply: Reply, context: Context) {
      // ${GATE}({ assistant_text: 'fake' }, context);
      const unrelated = ${GATE}({ assistant_text: 'other' }, context);
      return reply.send({ assistant_text: 'The chance is 67%.' });
    }` }])).toEqual([expect.objectContaining({ kind: 'assistant send', qualified: false })]);
  });
});
