/**
 * MODEL WRITER: a non-test production expression under src/ which (a) calls
 * an RPC writing scenarios.graph or model_versions (including SQL delegates),
 * (b) updates/upserts scenarios.graph or inserts/updates/upserts model_versions,
 * or (c) calls a store method wrapping (a)/(b) from outside the session store.
 * OUTSIDE THE DOOR: not lexically inside appendCheckedGraphWrite in its real
 * implementation, nor in the session store implementation reachable from that
 * door. Store methods not reached by the door are NOT exempt. Door callers are
 * counted separately. Counts are expressions, not files or unique RPC names.
 * commitModelChange is planned; today's door is appendCheckedGraphWrite.
 * TypeScript calls, constants, payloads, aliases and wrappers use the TS AST
 * and checker, never source regexes. SQL is a read-only migration-text census;
 * delegation is conservatively followed even when a wrapper forbids p_graph.
 * Named deployed-only RPCs carry explicit pg_proc evidence below; all other
 * missing RPC SQL / unresolved dynamic names are reported, never called safe.
 */
import ts from 'typescript';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DOOR_FILE = 'src/orchestrator-v5/persist-graph-write.ts';
const STORE_FILE = 'src/orchestrator-v5/session/supabase-store.ts';
const DOOR = 'appendCheckedGraphWrite';
// Read-only pg_proc evidence measured by af (8 Oct ~23:3xZ, project below); see PR #2891.
// These definitions live in another repo; this is not a blanket SQL exemption.
export const DEPLOYED_ONLY_RPCS = {
  copy_guest_scenario: {
    classification: 'writer',
    signature: 'copy_guest_scenario(p_source_scenario_id uuid, p_user_id uuid)',
    security: 'SECURITY DEFINER', volatility: 'VOLATILE',
    md5_prosrc: '135dd0df039e3ad513eb289eff06bd50',
    statement: 'INSERT INTO public.scenarios (user_id, title, graph, source_scenario_id) VALUES (p_user_id, v_title, v_graph, p_source_scenario_id)',
    source_repo: 'DecisionGuideAI',
    source_migration: 'supabase/migrations/20261001222932_copy_guest_scenario_20261001.sql',
    project: 'etmmuzwxtcjipwphdola', measured_at: '2026-10-08 ~23:3xZ',
  },
  is_scenario_member: {
    classification: 'non-writer',
    signature: 'is_scenario_member(p_scenario_id uuid, p_user_id uuid)',
    security: 'SECURITY DEFINER', volatility: 'STABLE',
    md5_prosrc: '725ce742b57cf11d9a8ef39ffcfc3f2c',
    statement: 'Complete prosrc has no INSERT/UPDATE (length 293)',
    prosrc_length: 293,
    source_repo: 'DecisionGuideAI',
    source_migration: null, // Migration directory supplied; exact filename not supplied.
    source_migration_directory: 'supabase/migrations',
    project: 'etmmuzwxtcjipwphdola', measured_at: '2026-10-08 ~23:3xZ',
  },
};
const REQUIRED_WRITERS = [
  'append_turn_atomic', 'append_turn_atomic_v2', 'append_turn_atomic_v3',
  'append_turn_atomic_v4', 'append_turn_atomic_v4r', 'append_turn_atomic_v5',
  'append_turn_atomic_v6', 'restore_model_version_atomic_v1', 'store_draft_graph',
];

function walk(dir, accept) {
  return readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    .flatMap(entry => entry.isDirectory()
      ? (['__tests__', '__mocks__', 'tests', 'fixtures', 'node_modules'].includes(entry.name)
        ? [] : walk(join(dir, entry.name), accept))
      : accept(entry.name) ? [join(dir, entry.name)] : []);
}

// Preserve offsets/lines while removing SQL comments and quoted string values.
// Dollar bodies are deliberately retained so PL/pgSQL statements are inspected.
function sqlCode(text) {
  return text.replace(/--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'/g,
    match => match.replace(/[^\n]/g, ' '));
}

export function classifyMigrationRpcs(root = ROOT) {
  const definitions = new Map();
  for (const file of walk(join(root, 'supabase/migrations'), name => name.endsWith('.sql'))) {
    const raw = readFileSync(file, 'utf8');
    const code = sqlCode(raw);
    const pattern = /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?(\w+)\s*\([\s\S]*?\bAS\s+(\$(?:\w+)?\$)([\s\S]*?)\2/gi;
    for (const match of code.matchAll(pattern)) {
      const body = match[3];
      const bodyOffset = match.index + match[0].indexOf(match[2]) + match[2].length;
      const evidence = offset => ({ file: relative(root, file),
        line: raw.slice(0, offset).split('\n').length });
      const direct = [];
      const writes = /\b(?:UPDATE\s+(?:public\.)?(scenarios|model_versions)\s+(?:\w+\s+)?SET\b([\s\S]*?)(?:\bWHERE\b|;)|INSERT\s+INTO\s+(?:public\.)?(scenarios|model_versions)\s*\(([^)]*)\))/gi;
      for (const write of body.matchAll(writes)) {
        const table = (write[1] ?? write[3]).toLowerCase();
        const columns = write[2] ?? write[4];
        if (table === 'model_versions' || /\bgraph\s*(?:=|,|$)/i.test(columns.trim())) {
          direct.push({ ...evidence(bodyOffset + write.index), table });
        }
      }
      // Latest definition per function name. Old overloads are not assumed live.
      definitions.set(match[1].toLowerCase(), { name: match[1].toLowerCase(),
        definition: evidence(match.index), end: evidence(match.index + match[0].length),
        direct, body, bodyOffset, evidence, delegates: [] });
    }
  }
  for (const def of definitions.values()) {
    for (const call of def.body.matchAll(/\b(?:public\.)?(\w+)\s*\(/g)) {
      if (definitions.has(call[1].toLowerCase()) && call[1].toLowerCase() !== def.name) {
        def.delegates.push({ name: call[1].toLowerCase(), ...def.evidence(def.bodyOffset + call.index) });
      }
    }
  }
  const writers = new Set([...definitions.values()].filter(d => d.direct.length).map(d => d.name));
  for (const [name, evidence] of Object.entries(DEPLOYED_ONLY_RPCS)) {
    if (!definitions.has(name) && evidence.classification === 'writer') writers.add(name);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const d of definitions.values()) {
      if (!writers.has(d.name) && d.delegates.some(call => writers.has(call.name))) {
        writers.add(d.name); changed = true;
      }
    }
  }
  for (const name of REQUIRED_WRITERS) {
    if (!writers.has(name)) throw new Error(`Required writer RPC not derived from migrations: ${name}`);
  }
  return { definitions, writers };
}

function unwrap(node) {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)
    || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node)
    || ts.isSatisfiesExpression(node))) node = node.expression;
  return node;
}

function memberName(node) {
  node = unwrap(node);
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    return node.argumentExpression.text;
  }
  if (ts.isIdentifier(node)) return node.text;
  return undefined;
}

function methodOwner(node) {
  let fn;
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isMethodDeclaration(parent)) return parent;
    if (ts.isFunctionDeclaration(parent)) fn ??= parent;
  }
  return fn;
}

export function census({ root = ROOT, extraFiles = [], doorFile = DOOR_FILE } = {}) {
  const sql = classifyMigrationRpcs(root);
  const files = walk(join(root, 'src'), name => name.endsWith('.ts')
    && !name.endsWith('.d.ts') && !name.endsWith('.test.ts') && !name.endsWith('.spec.ts'));
  const program = ts.createProgram([...files, ...extraFiles], {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext, skipLibCheck: true, noEmit: true,
  });
  const checker = program.getTypeChecker();
  function symbol(node) {
    node = unwrap(node);
    const at = ts.isPropertyAccessExpression(node) ? node.name
      : ts.isElementAccessExpression(node) ? node.argumentExpression : node;
    let sym = checker.getSymbolAtLocation(at);
    if (sym?.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
    return sym;
  }
  function strings(node, seen = new Set()) {
    node = unwrap(node);
    if (!node || seen.has(node)) return [];
    seen = new Set(seen).add(node);
    if (ts.isStringLiteralLike(node)) return [node.text];
    if (ts.isConditionalExpression(node)) return [...strings(node.whenTrue, seen), ...strings(node.whenFalse, seen)];
    const declarations = symbol(node)?.declarations ?? [];
    const values = declarations.flatMap(d => d.initializer ? strings(d.initializer, seen) : []);
    if (values.length) return [...new Set(values)];
    const type = checker.getTypeAtLocation(node);
    const types = type.isUnion() ? type.types : [type];
    return types.filter(t => t.flags & ts.TypeFlags.StringLiteral).map(t => t.value);
  }
  function named(node) {
    return node?.name && (ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name)) ? node.name.text : undefined;
  }
  function callable(node) {
    const sym = symbol(node);
    // A const alias to a function/method is followed through its initializer.
    const init = sym?.declarations?.find(d => ts.isVariableDeclaration(d) && d.initializer)?.initializer;
    if (init && (ts.isIdentifier(unwrap(init)) || ts.isPropertyAccessExpression(unwrap(init)))) return callable(init);
    return sym;
  }
  function operation(node, seen = new Set()) {
    node = unwrap(node);
    if (seen.has(node)) return undefined;
    seen = new Set(seen).add(node);
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) return memberName(node);
    for (const declaration of symbol(node)?.declarations ?? []) {
      if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
        const result = operation(declaration.initializer, seen);
        if (result) return result;
      }
      if (ts.isBindingElement(declaration)) return named({ name: declaration.propertyName ?? declaration.name });
    }
    return memberName(node);
  }
  const calls = [];
  const methods = [];
  for (const file of [...files, ...extraFiles]) {
    const source = program.getSourceFile(file);
    if (source.parseDiagnostics.length) throw new Error(`Cannot parse ${file}`);
    const visit = node => {
      if (ts.isCallExpression(node)) calls.push({ node, file: relative(root, file),
        line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        owner: methodOwner(node), name: operation(node.expression), sym: callable(node.expression) });
      if (ts.isMethodDeclaration(node)) methods.push(node);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  // Join implementation methods to declared ports via their implements clauses.
  // This also distinguishes SessionStore.append from archive.append.
  const equivalents = new Map();
  function link(a, b) {
    if (!a || !b) return;
    for (const [x, y] of [[a, b], [b, a]]) {
      if (!equivalents.has(x)) equivalents.set(x, new Set());
      equivalents.get(x).add(y);
    }
  }
  for (const method of methods) {
    const parent = method.parent;
    if (!ts.isClassDeclaration(parent)) continue;
    for (const heritage of parent.heritageClauses ?? []) {
      for (const typeNode of heritage.types) {
        link(symbol(method.name), checker.getTypeAtLocation(typeNode).getProperty(named(method)));
      }
    }
  }
  const diagnostics = [];
  const rpcCalls = [];
  const writers = new Set();
  const primitive = new Map();
  for (const call of calls) {
    if (call.name === 'rpc') {
      const names = strings(call.node.arguments[0]);
      rpcCalls.push({ ...call, names });
      if (!names.length) diagnostics.push(`${call.file}:${call.line}: unresolved RPC name`);
      for (const name of names) if (!sql.definitions.has(name) && !Object.hasOwn(DEPLOYED_ONLY_RPCS, name)) {
        diagnostics.push(`${call.file}:${call.line}: no migration SQL for RPC ${name}`);
      }
      if (names.some(name => sql.writers.has(name))) {
        primitive.set(call.node, { kind: 'rpc', callee: names.join('|') });
      }
    }
    if (['insert', 'update', 'upsert'].includes(call.name)) {
      let receiver = unwrap(call.node.expression);
      receiver = unwrap(receiver.expression);
      const from = new Set();
      const trace = (node, seen = new Set()) => {
        node = unwrap(node);
        if (!node || seen.has(node)) return;
        seen = new Set(seen).add(node);
        if (ts.isCallExpression(node)) {
          if (memberName(node.expression) === 'from') strings(node.arguments[0]).forEach(table => from.add(table));
          const expr = unwrap(node.expression);
          if (ts.isPropertyAccessExpression(expr) || ts.isElementAccessExpression(expr)) trace(expr.expression, seen);
        } else {
          for (const d of symbol(node)?.declarations ?? []) if (d.initializer) trace(d.initializer, seen);
        }
      };
      trace(receiver);
      const payload = call.node.arguments[0];
      const type = payload && checker.getTypeAtLocation(payload);
      const payloadType = type && (checker.getIndexTypeOfType(type, ts.IndexKind.Number) ?? type);
      const types = payloadType?.isUnion() ? payloadType.types : payloadType ? [payloadType] : [];
      const hasGraph = types.some(t => t.getProperty('graph')
        || (t.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown))
        || checker.getIndexTypeOfType(t, ts.IndexKind.String));
      if (from.has('model_versions') || (from.has('scenarios') && call.name !== 'insert' && hasGraph)) {
        primitive.set(call.node, { kind: 'table', callee: `${[...from].join('|')}.${call.name}` });
      }
    }
  }
  function mark(sym) {
    if (!sym || writers.has(sym)) return false;
    writers.add(sym);
    for (const next of equivalents.get(sym) ?? []) mark(next);
    return true;
  }
  // Only methods are propagated as store/adapter wrappers. Route registration
  // functions do not become writers merely because they register a handler.
  for (const call of calls) if (primitive.has(call.node) && ts.isMethodDeclaration(call.owner ?? {})) {
    mark(symbol(call.owner.name));
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const call of calls) if (writers.has(call.sym) && ts.isMethodDeclaration(call.owner ?? {})) {
      changed = mark(symbol(call.owner.name)) || changed;
    }
  }
  // Derive the private session implementation reachable from the real door.
  // No file-wide exemption: a storeDraftGraph RPC remains outside the door.
  const sessionReachable = new Set();
  for (const call of calls) if (call.file === doorFile && named(call.owner) === DOOR) {
    if (writers.has(call.sym)) sessionReachable.add(call.sym);
  }
  changed = true;
  while (changed) {
    changed = false;
    for (const sym of [...sessionReachable]) for (const next of equivalents.get(sym) ?? []) {
      if (!sessionReachable.has(next)) { sessionReachable.add(next); changed = true; }
    }
    for (const call of calls) if (call.file === STORE_FILE
      && sessionReachable.has(call.owner?.name && symbol(call.owner.name)) && call.sym) {
      if (!sessionReachable.has(call.sym)) { sessionReachable.add(call.sym); changed = true; }
    }
  }
  const sites = [];
  const excluded = [];
  const doorSymbols = new Set();
  for (const source of program.getSourceFiles()) if (relative(root, source.fileName) === doorFile) {
    source.forEachChild(node => {
      if (ts.isFunctionDeclaration(node) && named(node) === DOOR) doorSymbols.add(symbol(node.name));
    });
  }
  for (const call of calls) {
    let inDoor = false;
    for (let ancestor = call.node.parent; ancestor; ancestor = ancestor.parent) {
      if (call.file === doorFile && ts.isFunctionDeclaration(ancestor) && named(ancestor) === DOOR) inDoor = true;
    }
    const inSession = call.file === STORE_FILE
      && sessionReachable.has(call.owner?.name && symbol(call.owner.name));
    const isDoor = doorSymbols.has(call.sym);
    const detail = isDoor ? { kind: 'door_caller', callee: DOOR } : primitive.get(call.node)
      ?? (writers.has(call.sym) ? { kind: 'store_method', callee: call.node.expression.getText() } : undefined);
    if (!detail) continue;
    const site = { file: call.file, line: call.line, ...detail };
    if (inDoor || inSession) {
      excluded.push({ ...site, reason: inDoor ? 'inside door implementation' : 'session implementation reached by door' });
    } else if (detail.kind !== 'store_method' || !call.file.startsWith('src/orchestrator-v5/session/')) {
      sites.push(site);
    } else if (primitive.has(call.node)) sites.push(site);
  }
  const sort = (a, b) => a.file.localeCompare(b.file) || a.line - b.line;
  const rpcNames = new Set([...sql.definitions.keys(), ...Object.keys(DEPLOYED_ONLY_RPCS), ...rpcCalls.flatMap(c => c.names)]);
  const rpcs = [...rpcNames].sort().map(name => {
    const def = sql.definitions.get(name);
    const deployed = !def && Object.hasOwn(DEPLOYED_ONLY_RPCS, name) ? DEPLOYED_ONLY_RPCS[name] : undefined;
    return { name, classification: !def && !deployed ? 'unresolved' : sql.writers.has(name) ? 'writer' : 'non-writer',
      deployed_evidence: deployed,
      definition: def?.definition, end: def?.end, direct_writes: def?.direct ?? [],
      writer_delegates: def?.delegates.filter(d => sql.writers.has(d.name)) ?? [],
      call_sites: rpcCalls.filter(c => c.names.includes(name)).map(c => ({ file: c.file, line: c.line })) };
  });
  return { outside_door: sites.filter(s => s.kind !== 'door_caller').length,
    door_callers: sites.filter(s => s.kind === 'door_caller').length,
    sites: sites.sort(sort), excluded: excluded.sort(sort), rpcs,
    production_files: files.length, diagnostics: [...new Set(diagnostics)].sort() };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(census(), null, 2));
}
