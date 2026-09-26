/**
 * Extract the FP3 explicit-Run interpreter instruction stack from a route source file,
 * WITHOUT importing the route (importing it would boot the service's module graph).
 *
 *   pnpm exec tsx tools/agent-reply-eval/extract-stack.ts --route src/routes/agent-v1-turn.ts --out stack.txt
 *
 * DERIVED, NOT MIRRORED: the composition is read from the route itself — the one
 * `instructions:` template literal that includes `INTERPRETER_V02_BANKED` (at 8428207:
 * `${AGENT_INSTRUCTIONS}\n\n${INTERPRET_ONLY_CONSTRAINT}\n\n${INTERPRETER_V02_BANKED}`;
 * at the FP3 capture head 9af274b1 it had no interpret-only line). Every identifier in it
 * is resolved from the file's own declarations, evaluating ONLY string literals, `+` of
 * strings, and `[...strings].join(<string>)`. Anything else — a call, a variable it cannot
 * resolve, a second candidate template — is refused: a stack that silently differs from
 * the served one would make any A/B meaningless.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import ts from 'typescript';

export interface ExtractedStack {
  /** Exactly what the route passes as `instructions` on the explicit-Run interpretation call. */
  readonly stack: string;
  /** The template as written in the route, e.g. "`${A}\n\n${B}`". */
  readonly composition: string;
  /** The identifiers the template interpolates, in order. */
  readonly parts: readonly string[];
  /** Every conditional resolved while evaluating, with the branch taken (each must be decided by the caller). */
  readonly assumed: Readonly<Record<string, boolean>>;
}

/**
 * `assume` decides each conditional the stack depends on, keyed by the condition's source text
 * (at 8428207: `config.proxy.agentLanePreview === true`, false on staging, whose Agent turns run
 * in `full` mode). An undecided conditional is refused — config is not guessed.
 */
export function extractStack(source: string, fileName = 'agent-v1-turn.ts', assume: Readonly<Record<string, boolean>> = {}): ExtractedStack {
  const assumed: Record<string, boolean> = {};
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const decls = new Map<string, ts.Expression[]>();
  const templates: ts.TemplateExpression[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer !== undefined) {
      decls.set(n.name.text, [...(decls.get(n.name.text) ?? []), n.initializer]);
    }
    if (
      ts.isPropertyAssignment(n) &&
      ts.isIdentifier(n.name) &&
      n.name.text === 'instructions' &&
      ts.isTemplateExpression(n.initializer) &&
      n.initializer.templateSpans.some((s) => ts.isIdentifier(s.expression) && s.expression.text === 'INTERPRETER_V02_BANKED')
    ) {
      templates.push(n.initializer);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (templates.length !== 1) {
    throw new Error(`expected exactly one \`instructions:\` template that includes INTERPRETER_V02_BANKED, found ${templates.length}; refusing to guess`);
  }

  const resolving = new Set<string>();
  const evaluate = (node: ts.Expression, where: string): string => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return evaluate(node.expression, where);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) return evaluate(node.left, where) + evaluate(node.right, where);
    if (ts.isConditionalExpression(node)) {
      const cond = node.condition.getText(sf);
      const branch = assume[cond];
      if (branch === undefined) throw new Error(`${where}: conditional on \`${cond}\` — decide it with --assume-true/--assume-false; config is not guessed`);
      assumed[cond] = branch;
      return evaluate(branch ? node.whenTrue : node.whenFalse, where);
    }
    if (ts.isIdentifier(node)) {
      const name = node.text;
      const found = decls.get(name) ?? [];
      if (found.length !== 1) throw new Error(`${where}: ${name} has ${found.length} declarations; refusing to guess`);
      if (resolving.has(name)) throw new Error(`${where}: ${name} refers to itself`);
      resolving.add(name);
      const value = evaluate(found[0]!, name);
      resolving.delete(name);
      return value;
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'join' &&
      ts.isArrayLiteralExpression(node.expression.expression) &&
      node.arguments.length === 1
    ) {
      const parts = node.expression.expression.elements.map((e) => {
        if (ts.isSpreadElement(e) || ts.isOmittedExpression(e)) throw new Error(`${where}: unsupported array element`);
        return evaluate(e, where);
      });
      return parts.join(evaluate(node.arguments[0]!, where));
    }
    throw new Error(`${where}: cannot evaluate ${ts.SyntaxKind[node.kind]} statically`);
  };

  const t = templates[0]!;
  let stack = t.head.text;
  const parts: string[] = [];
  for (const span of t.templateSpans) {
    if (!ts.isIdentifier(span.expression)) throw new Error('the instructions template interpolates something other than a named constant');
    parts.push(span.expression.text);
    stack += evaluate(span.expression, 'instructions') + span.literal.text;
  }
  return { stack, composition: t.getText(sf), parts, assumed };
}

function main(): void {
  const argv = process.argv.slice(2);
  const arg = (k: string): string | null => {
    const i = argv.indexOf(k);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1]! : null;
  };
  const route = arg('--route');
  const out = arg('--out');
  if (route === null || out === null) {
    throw new Error('usage: extract-stack.ts --route <agent-v1-turn.ts> --out <file> [--assume-true <condition>] [--assume-false <condition>]');
  }
  const assume: Record<string, boolean> = {};
  argv.forEach((k, i) => {
    if ((k === '--assume-true' || k === '--assume-false') && argv[i + 1] !== undefined) assume[argv[i + 1]!] = k === '--assume-true';
  });
  const s = extractStack(readFileSync(route, 'utf8'), route, assume);
  writeFileSync(out, s.stack);
  console.log(JSON.stringify({ route, out, chars: s.stack.length, composition: s.composition, parts: s.parts, assumed: s.assumed }));
}

if (process.argv[1] !== undefined && /extract-stack\.ts$/.test(process.argv[1])) main();
